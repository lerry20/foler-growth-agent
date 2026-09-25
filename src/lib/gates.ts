import { prisma } from "@/lib/db";
import type { Analysis } from "@/lib/ai/types";
import type { ActionType } from "@prisma/client";

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
}

const MENTION_ALLOWED_STATES = new Set([
  "PERMISSION_GRANTED",
  "FOLER_INTRODUCED",
  "INTEREST_DETECTED",
  "WAITLIST_INVITED",
]);
const INVITE_ALLOWED_STATES = new Set(["FOLER_INTRODUCED", "INTEREST_DETECTED"]);

function stripFolerSentences(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !/fol[ēe]r/i.test(s))
    .join(" ")
    .trim();
}

export function applyGates(analysis: Analysis, ctx: GateContext): { analysis: Analysis; blocked: string[] } {
  const a: Analysis = { ...analysis };
  const blocked: string[] = [];
  const community = ctx.community;

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

  if (conversation.lead.category === "IGNORE") reasons.push("Lead category is IGNORE");

  return { ok: reasons.length === 0, reasons };
}
