import { prisma } from "@/lib/db";
import { qualifyConversation } from "@/lib/ai/analyze";
import { outboundPreflight } from "@/lib/gates";
import { getRedditProvider, RedditProviderError } from "@/lib/reddit";
import { pauseOutbound } from "@/lib/health";
import { advanceStage } from "@/lib/pipeline";
import { ourUsername } from "@/lib/ingest";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { sendActionForApproval } from "@/lib/telegram/notify";
import type { Action, ActionStatus, LeadStage, PermissionState } from "@prisma/client";

export async function generateAction(conversationId: string, opts?: { force?: boolean }): Promise<Action | null> {
  const analysis = await qualifyConversation(conversationId, { force: opts?.force ?? true });
  if (analysis.recommended_action === "IGNORE" || !analysis.suggested_response) return null;

  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  const messageCount = await prisma.message.count({ where: { conversationId } });

  const preflight = await outboundPreflight(conversationId, analysis.recommended_action);

  await prisma.action.updateMany({
    where: { conversationId, status: { in: ["PROPOSED", "APPROVAL_REQUESTED"] } },
    data: { status: "SUPERSEDED" },
  });

  const action = await prisma.action.create({
    data: {
      conversationId,
      type: analysis.recommended_action,
      proposedResponse: analysis.suggested_response,
      reason: analysis.reason + (analysis.blocked.length ? ` [blocked: ${analysis.blocked.join("; ")}]` : ""),
      shouldMentionFoler: analysis.should_mention_foler,
      status: "PROPOSED",
      conversationVersion: messageCount,
      errorMessage: preflight.ok ? null : `Preflight: ${preflight.reasons.join("; ")}`,
    },
  });
  void conversation;

  await prisma.event.create({
    data: { type: "ACTION_GENERATED", leadId: conversation.leadId, conversationId, actionId: action.id },
  });

  const nextStage = advanceStage(conversation.stage, "APPROVAL_PENDING");
  if (nextStage !== conversation.stage) {
    await prisma.conversation.update({ where: { id: conversationId }, data: { stage: nextStage } });
    await mirrorLeadStage(conversation.leadId);
  }

  return action;
}

async function mirrorLeadStage(leadId: string): Promise<void> {
  const convos = await prisma.conversation.findMany({ where: { leadId }, select: { stage: true } });
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  let stage: LeadStage = lead.stage;
  for (const c of convos) stage = advanceStage(stage, c.stage);
  if (stage !== lead.stage) await prisma.lead.update({ where: { id: leadId }, data: { stage } });
}

export async function requestApproval(actionId: string): Promise<Action> {
  const action = await prisma.action.update({
    where: { id: actionId },
    data: { status: "APPROVAL_REQUESTED" },
    include: { conversation: { include: { lead: true } } },
  });
  await prisma.event.create({
    data: {
      type: "ACTION_APPROVAL_REQUESTED",
      leadId: action.conversation.leadId,
      conversationId: action.conversationId,
      actionId,
    },
  });
  const sent = await sendActionForApproval(action, action.conversation, action.conversation.lead);
  if (sent) {
    await prisma.action.update({
      where: { id: actionId },
      data: { telegramMessageId: sent.messageId, telegramChatId: sent.chatId },
    });
  }
  return action;
}

export async function approveAction(
  actionId: string,
  opts: { by: string; finalResponse?: string; expectedVersion?: number },
): Promise<{ ok: boolean; reason?: string }> {
  const action = await prisma.action.findUniqueOrThrow({ where: { id: actionId } });
  if (action.status !== "PROPOSED" && action.status !== "APPROVAL_REQUESTED") {
    return { ok: false, reason: `Action status is ${action.status}, cannot approve` };
  }
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== action.conversationVersion) {
    return { ok: false, reason: "Stale — action was generated for a different conversation version" };
  }
  const currentCount = await prisma.message.count({ where: { conversationId: action.conversationId } });
  if (currentCount !== action.conversationVersion) {
    return { ok: false, reason: "Stale — the conversation changed since this action was generated" };
  }
  const health = await prisma.accountHealth.findUnique({ where: { id: "default" } });
  if (health?.outboundPaused && (!health.pausedUntil || health.pausedUntil > new Date())) {
    return { ok: false, reason: `Outbound paused: ${health.pausedReason ?? "rate limited"}` };
  }

  await prisma.action.update({
    where: { id: actionId },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      finalResponse: opts.finalResponse ?? action.proposedResponse,
    },
  });
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: action.conversationId } });
  await prisma.event.create({
    data: { type: "ACTION_APPROVED", leadId: conversation.leadId, conversationId: action.conversationId, actionId, payload: { by: opts.by } },
  });
  await executeAction(actionId);
  return { ok: true };
}

export async function rejectAction(actionId: string, opts: { by: string; reason?: string }): Promise<void> {
  const action = await prisma.action.update({ where: { id: actionId }, data: { status: "REJECTED", rejectedAt: new Date() } });
  await prisma.event.create({
    data: { type: "ACTION_REJECTED", leadId: (await prisma.conversation.findUniqueOrThrow({ where: { id: action.conversationId } })).leadId, conversationId: action.conversationId, actionId, payload: { by: opts.by, reason: opts.reason } },
  });
}

export async function snoozeAction(actionId: string, hours = 24): Promise<void> {
  const action = await prisma.action.update({ where: { id: actionId }, data: { status: "SNOOZED" } });
  await prisma.conversation.update({
    where: { id: action.conversationId },
    data: { snoozedUntil: new Date(Date.now() + hours * 36e5) },
  });
  await prisma.event.create({
    data: { type: "ACTION_SNOOZED", leadId: (await prisma.conversation.findUniqueOrThrow({ where: { id: action.conversationId } })).leadId, conversationId: action.conversationId, actionId, payload: { hours } },
  });
}

export async function executeAction(actionId: string): Promise<void> {
  const action = await prisma.action.findUniqueOrThrow({ where: { id: actionId } });
  const provider = await getRedditProvider();
  if (!provider.capabilities.createComment) {
    await prisma.action.update({ where: { id: actionId }, data: { status: "MANUAL_REQUIRED" } });
    return;
  }
  await prisma.action.update({ where: { id: actionId }, data: { status: "EXECUTING" } });
  const lastInbound = await prisma.message.findFirst({
    where: {
      conversationId: action.conversationId,
      direction: "INBOUND",
      isOriginalPost: false,
      NOT: [{ redditId: null }, { redditId: { startsWith: "manual:" } }],
    },
    orderBy: { postedAt: "desc" },
  });
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: action.conversationId } });
  try {
    const res = await provider.createComment({
      parentId: lastInbound?.redditId ?? conversation.redditPostId,
      parentKind: lastInbound ? "comment" : "post",
      text: action.finalResponse ?? action.proposedResponse,
    });
    await markPosted(actionId, { redditId: res.id, url: res.url, by: "provider" });
  } catch (err) {
    if (err instanceof RedditProviderError && (err.kind === "RATE_LIMITED" || err.kind === "FORBIDDEN")) {
      await pauseOutbound(`executeAction: ${err.message}`, err.retryAfterSeconds ?? 60);
    }
    await prisma.action.update({
      where: { id: actionId },
      data: { status: "FAILED", errorMessage: err instanceof Error ? err.message : String(err) },
    });
  }
}

export async function markPosted(
  actionId: string,
  opts: { redditId?: string; url?: string; by: string },
): Promise<void> {
  const action = await prisma.action.findUniqueOrThrow({
    where: { id: actionId },
    include: { conversation: true },
  });
  const author = await ourUsername();
  const content = action.finalResponse ?? action.proposedResponse;
  const postedStatuses: ActionStatus[] = ["POSTED"];
  if (postedStatuses.includes(action.status)) return;

  await prisma.message.create({
    data: {
      conversationId: action.conversationId,
      redditId: opts.redditId ?? `manual:${actionId}`,
      author,
      content,
      postedAt: new Date(),
      direction: "OUTBOUND",
      actionId,
    },
  });
  await prisma.action.update({ where: { id: actionId }, data: { status: "POSTED", executedAt: new Date() } });
  await prisma.event.create({
    data: {
      type: "COMMENT_POSTED",
      leadId: action.conversation.leadId,
      conversationId: action.conversationId,
      actionId,
      payload: { by: opts.by, url: opts.url },
    },
  });

  const health = await prisma.accountHealth.findUnique({ where: { id: "default" } });
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const sameDay = health && health.updatedAt >= day;
  await prisma.accountHealth.upsert({
    where: { id: "default" },
    update: { commentsToday: sameDay ? { increment: 1 } : 1 },
    create: { id: "default", commentsToday: 1 },
  });

  // Stage + permission transitions by action type
  const conversation = action.conversation;
  let stage: LeadStage = conversation.stage;
  let permission: PermissionState = conversation.permissionState;
  const events: { type: "PERMISSION_REQUESTED" | "FOLER_INTRODUCED" | "WAITLIST_INVITED"; payload?: object }[] = [];

  switch (action.type) {
    case "HELP":
      stage = advanceStage(stage, "HELPING");
      break;
    case "ENGAGE":
      stage = advanceStage(stage, "WAITING_FOR_RESPONSE");
      break;
    case "FOLLOW_UP":
      stage = advanceStage(stage, "ACTIVE_CONVERSATION");
      break;
    case "INTRODUCE_FOLER":
      if (permission === "NO_FOLER_MENTION" || permission === "FOLER_RELEVANCE_DETECTED") {
        permission = "PERMISSION_REQUESTED";
        events.push({ type: "PERMISSION_REQUESTED" });
        stage = advanceStage(stage, "ACTIVE_CONVERSATION");
      } else if (permission === "PERMISSION_GRANTED") {
        permission = "FOLER_INTRODUCED";
        events.push({ type: "FOLER_INTRODUCED" });
        stage = advanceStage(stage, "FOLER_INTRODUCED");
      }
      break;
    case "WAITLIST_INVITE": {
      permission = "WAITLIST_INVITED";
      stage = advanceStage(stage, "WAITLIST_INVITED");
      events.push({ type: "WAITLIST_INVITED", payload: { url: opts.url } });
      const campaign = await getSetting(SETTING_KEYS.attributionCampaign, "reddit-growth-agent");
      const existing = await prisma.conversion.findFirst({ where: { leadId: conversation.leadId } });
      if (existing) {
        await prisma.conversion.update({ where: { id: existing.id }, data: { invitedAt: new Date(), conversationId: conversation.id } });
      } else {
        await prisma.conversion.create({
          data: {
            leadId: conversation.leadId,
            conversationId: conversation.id,
            subreddit: conversation.subreddit,
            source: "reddit",
            campaign,
            invitedAt: new Date(),
            attribution: { url: opts.url ?? null, leadId: conversation.leadId, conversationId: conversation.id, campaign },
          },
        });
      }
      break;
    }
    default:
      break;
  }

  await prisma.conversation.update({ where: { id: conversation.id }, data: { stage, permissionState: permission, lastActivityAt: new Date() } });
  for (const e of events) {
    await prisma.event.create({ data: { type: e.type, leadId: conversation.leadId, conversationId: conversation.id, actionId, payload: e.payload } });
  }
  await mirrorLeadStage(conversation.leadId);
}

export async function generateActionsForCandidates(opts?: { limit?: number }): Promise<number> {
  const conversations = await prisma.conversation.findMany({
    where: {
      stage: "QUALIFIED",
      lead: { category: { in: ["HOT", "WARM"] } },
      actions: { none: { status: { in: ["PROPOSED", "APPROVAL_REQUESTED", "APPROVED"] } } },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: new Date() } }],
    },
    take: opts?.limit ?? 10,
  });
  let n = 0;
  for (const c of conversations) {
    const action = await generateAction(c.id);
    if (action) {
      await requestApproval(action.id);
      n++;
    }
  }
  return n;
}
