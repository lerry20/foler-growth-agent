import { prisma } from "@/lib/db";
import type { Analysis } from "@/lib/ai/types";
import type { ActionType, PermissionState } from "@prisma/client";

export interface GateContext {
  subreddit: string;
  permissionState: string;
  waitlistUrl: string;
  community?: {
    folerIntroAllowed: boolean;
    dmAllowed: boolean;
    minRelevanceScore: number;
    allowedActions: ActionType[];
  } | null;
  leadScore?: number;
  hasOutbound?: boolean;
  postText?: string;
}

const MINOR_PATTERNS = [
  /\b(?:i'?m|i am|im)\s+(?:a\s+)?1[0-7]\b(?!\s*(?:months?|weeks?|years?\s+(?:on|into|of)))/i,
  /(?:^|[\s("'—–-])1[0-7]\s*[mf]\b/i,
  /\b1[0-7]\s*(?:yo|y\/o|years?\s+old)\b/i,
  /\b(?:as a|being a)\s+1[0-7]\s+year\s+old\b/i,
  /\b(?:i'?m|i am)\s+(?:only\s+)?1[0-7]\b/i,
  /\bi'?m a minor\b|\bunder 18\b|\bstill in (?:middle|high) school\b/i,
];

export function detectsMinor(text: string): boolean {
  return MINOR_PATTERNS.some((p) => p.test(text));
}

export const PERMISSION_ORDER: PermissionState[] = [
  "NO_FOLER_MENTION",
  "FOLER_RELEVANCE_DETECTED",
  "PERMISSION_REQUESTED",
  "PERMISSION_GRANTED",
  "FOLER_INTRODUCED",
  "INTEREST_DETECTED",
  "WAITLIST_INVITED",
  "WAITLIST_CLICKED",
  "WAITLIST_SIGNUP",
];

const atOrPast = (state: string, target: PermissionState) =>
  PERMISSION_ORDER.indexOf(state as PermissionState) >= PERMISSION_ORDER.indexOf(target);

type Signal = Analysis["permission_signal"];

export function effectivePermissionSignal(
  signal: Signal,
  state: string,
): { signal: Signal; ignoredReason?: string } {
  if (signal === "PERMISSION_GRANTED" && !atOrPast(state, "PERMISSION_REQUESTED")) {
    return {
      signal: "NONE",
      ignoredReason: "Permission signal ignored: FOLĒR permission was never requested in this thread",
    };
  }
  if (signal === "INTEREST_EXPRESSED" && !atOrPast(state, "FOLER_INTRODUCED")) {
    return {
      signal: "NONE",
      ignoredReason: "Permission signal ignored: FOLĒR was never introduced",
    };
  }
  return { signal };
}

const MENTION_ALLOWED_STATES = new Set([
  "PERMISSION_GRANTED",
  "FOLER_INTRODUCED",
  "INTEREST_DETECTED",
  "WAITLIST_INVITED",
  "WAITLIST_CLICKED",
]);
const INVITE_ALLOWED_STATES = new Set(["FOLER_INTRODUCED", "INTEREST_DETECTED"]);

const STRIP_PATTERN =
  /fol[ēe]r|waitlist|early access|prototype|\bbeta\b|we'?re building|i'?m building|building a|building something|working on (a|something)|something related|interested in hearing|hear(ing)? more about it|want me to share|happy to share more|\{\{\s*waitlist_url\s*\}\}/i;
const LONE_DASH = /(^|\s)[—–-]\s*$/;

function sentenceIsStrip(s: string): boolean {
  return STRIP_PATTERN.test(s) || LONE_DASH.test(s.trim());
}

export function stripFolerSentences(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !sentenceIsStrip(s))
    .join(" ")
    .trim();
}

function applyStripFloor(a: Analysis, blocked: string[]): void {
  a.suggested_response = stripFolerSentences(a.suggested_response);
  if (a.suggested_response.length < 40) {
    a.suggested_response = "";
    blocked.push("Response removed by gates — regenerate");
  }
}

export function applyGates(analysis: Analysis, ctx: GateContext): { analysis: Analysis; blocked: string[] } {
  const a: Analysis = { ...analysis };
  const blocked: string[] = [];
  const community = ctx.community;
  const originalAction = a.recommended_action;

  if (ctx.postText && detectsMinor(ctx.postText)) {
    a.recommended_action = "IGNORE";
    a.should_mention_foler = false;
    a.suggested_response = "";
    a.permission_signal = "NONE";
    blocked.push("Minor protection: author indicates they are under 18 — no engagement");
    if (a.recommended_action !== originalAction) {
      a.reason = `[gated: ${originalAction} → ${a.recommended_action}] ${a.reason}`;
    }
    return { analysis: a, blocked };
  }

  const { signal, ignoredReason } = effectivePermissionSignal(a.permission_signal, ctx.permissionState);
  if (ignoredReason) {
    a.permission_signal = signal;
    blocked.push(ignoredReason);
  }

  if (!ctx.hasOutbound) {
    a.should_mention_foler = false;
    applyStripFloor(a, blocked);
    if (a.recommended_action === "INTRODUCE_FOLER" || a.recommended_action === "WAITLIST_INVITE" || a.recommended_action === "DM") {
      a.recommended_action = "HELP";
      blocked.push("Help first: no prior helpful reply in this thread");
    }
  }

  if (community && !community.folerIntroAllowed && (a.recommended_action === "INTRODUCE_FOLER" || a.recommended_action === "WAITLIST_INVITE")) {
    a.recommended_action = a.recommended_action === "WAITLIST_INVITE" ? "FOLLOW_UP" : "ENGAGE";
    a.should_mention_foler = false;
    blocked.push("Community does not allow FOLĒR introduction; downgraded action");
  }

  const mentionAllowed =
    MENTION_ALLOWED_STATES.has(ctx.permissionState) ||
    a.permission_signal === "PERMISSION_GRANTED" ||
    a.permission_signal === "INTEREST_EXPRESSED";
  if (a.should_mention_foler && !mentionAllowed) {
    a.should_mention_foler = false;
    const stripped = stripFolerSentences(a.suggested_response);
    if (stripped !== a.suggested_response) a.suggested_response = stripped;
    blocked.push("FOLĒR mention blocked: permission workflow step not reached");
  }

  if (a.recommended_action === "WAITLIST_INVITE") {
    const inviteAllowed = INVITE_ALLOWED_STATES.has(ctx.permissionState) || a.permission_signal === "INTEREST_EXPRESSED";
    if (!inviteAllowed) {
      a.recommended_action = "FOLLOW_UP";
      a.suggested_response = "";
      blocked.push("WAITLIST_INVITE blocked: interest not yet detected");
    } else if (!ctx.waitlistUrl) {
      a.recommended_action = "FOLLOW_UP";
      applyStripFloor(a, blocked);
      blocked.push("Waitlist URL not configured in Settings");
    }
  }

  if (a.recommended_action === "DM" && !(community?.dmAllowed)) {
    a.recommended_action = "ENGAGE";
    blocked.push("DM not allowed in this community; switched to public ENGAGE");
  }

  if (community && community.minRelevanceScore > 0 && (ctx.leadScore ?? 0) < community.minRelevanceScore) {
    if (a.recommended_action === "INTRODUCE_FOLER" || a.recommended_action === "WAITLIST_INVITE" || a.recommended_action === "DM") {
      a.recommended_action = "IGNORE";
      a.suggested_response = "";
      blocked.push(`Below community min relevance score (${community.minRelevanceScore}); promotional action blocked`);
    }
  }

  if (community && community.allowedActions.length > 0 && !community.allowedActions.includes(a.recommended_action as ActionType)) {
    a.recommended_action = "IGNORE";
    a.suggested_response = "";
    blocked.push(`Action not allowed in r/${ctx.subreddit} per community config`);
  }

  if (a.recommended_action !== originalAction) {
    a.reason = `[gated: ${originalAction} → ${a.recommended_action}] ${a.reason}`;
  }

  return { analysis: a, blocked };
}

export async function outboundPreflight(
  conversationId: string,
  actionType: ActionType,
): Promise<{ ok: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { messages: { orderBy: { postedAt: "desc" } }, lead: { include: { conversations: true } } },
  });

  const health = await prisma.accountHealth.findUnique({ where: { id: "default" } });
  if (health?.outboundPaused && (!health.pausedUntil || health.pausedUntil > new Date())) {
    reasons.push(`Outbound paused: ${health.pausedReason ?? "rate limited"}`);
  }

  const pending = await prisma.action.findFirst({
    where: { conversationId, status: { in: ["PROPOSED", "APPROVAL_REQUESTED", "APPROVED"] } },
  });
  if (pending) reasons.push("A pending action already exists for this conversation");

  const lastOutbound = conversation.messages.find((m) => m.direction === "OUTBOUND");
  const lastInbound = conversation.messages.find((m) => m.direction === "INBOUND");
  if (lastOutbound && Date.now() - lastOutbound.postedAt.getTime() < 12 * 36e5) {
    if (!lastInbound || lastInbound.postedAt < lastOutbound.postedAt) {
      reasons.push("Last outbound message is <12h old with no newer inbound reply");
    }
  }

  const siblingIds = conversation.lead.conversations.filter((c) => c.id !== conversationId).map((c) => c.id);
  if (siblingIds.length) {
    const contacted = await prisma.message.findFirst({
      where: { conversationId: { in: siblingIds }, direction: "OUTBOUND", isOriginalPost: false },
    });
    if (contacted) reasons.push("Lead already contacted in another conversation");
  }

  if (actionType === "INTRODUCE_FOLER") {
    const intro = await prisma.event.findFirst({ where: { conversationId, type: "FOLER_INTRODUCED" } });
    if (intro) reasons.push("FOLĒR already introduced in this conversation");
  }
  if (actionType === "WAITLIST_INVITE") {
    const invited = await prisma.event.findFirst({ where: { conversationId, type: "WAITLIST_INVITED" } });
    if (invited) reasons.push("Waitlist already invited in this conversation");
  }

  const originalPost = conversation.messages.find((m) => m.isOriginalPost);
  if (originalPost && Date.now() - originalPost.postedAt.getTime() > 90 * 864e5) {
    reasons.push("Original post is older than 90 days");
  }

  if (conversation.lead.doNotContact) reasons.push("Lead marked do-not-contact");
  if (conversation.lead.category === "IGNORE") reasons.push("Lead category is IGNORE");

  return { ok: reasons.length === 0, reasons };
}
