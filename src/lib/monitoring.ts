import { prisma } from "@/lib/db";
import { ingestConversation } from "@/lib/ingest";
import { getRedditProvider, RedditProviderError } from "@/lib/reddit";
import { advanceStage } from "@/lib/pipeline";
import { generateAction, requestApproval } from "@/lib/actions";
import type { RedditSource } from "@prisma/client";

const SOURCE_BY_PROVIDER = { mock: "MOCK", public_web: "PUBLIC_WEB", official_api: "OFFICIAL_API" } as const;

async function afterNewInbound(conversationId: string): Promise<void> {
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  await prisma.event.create({
    data: { type: "USER_REPLIED", leadId: conversation.leadId, conversationId },
  });
  const stage = advanceStage(conversation.stage, "ACTIVE_CONVERSATION");
  if (stage !== conversation.stage) {
    await prisma.conversation.update({ where: { id: conversationId }, data: { stage, lastActivityAt: new Date() } });
    await prisma.lead.update({ where: { id: conversation.leadId }, data: { stage: advanceStage((await prisma.lead.findUniqueOrThrow({ where: { id: conversation.leadId } })).stage, stage) } });
  }
  const action = await generateAction(conversationId);
  if (action) await requestApproval(action.id);
}

export async function refreshConversation(conversationId: string): Promise<{ ok: boolean; manual?: boolean; reason?: string; newMessages?: number }> {
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  const provider = await getRedditProvider();
  const lastOutbound = await prisma.message.findFirst({
    where: { conversationId, direction: "OUTBOUND" },
    orderBy: { postedAt: "desc" },
  });
  try {
    const convo = await provider.getConversation(conversation.redditPostId);
    const source: RedditSource = SOURCE_BY_PROVIDER[provider.name] ?? conversation.source;
    const res = await ingestConversation(convo.post, convo.comments, source);
    const newInbound = await prisma.message.findFirst({
      where: {
        conversationId,
        direction: "INBOUND",
        isOriginalPost: false,
        ...(lastOutbound ? { postedAt: { gt: lastOutbound.postedAt } } : {}),
      },
      orderBy: { postedAt: "desc" },
    });
    if (newInbound) await afterNewInbound(conversationId);
    return { ok: true, newMessages: res.newMessageCount };
  } catch (err) {
    if (err instanceof RedditProviderError && (err.kind === "UNSUPPORTED" || err.kind === "RATE_LIMITED")) {
      return { ok: false, manual: true, reason: err.message };
    }
    throw err;
  }
}

export async function importReplyManually(
  conversationId: string,
  input: { author: string; content: string; postedAt?: Date },
): Promise<void> {
  await prisma.message.create({
    data: {
      conversationId,
      redditId: `manual:${crypto.randomUUID().slice(0, 12)}`,
      author: input.author,
      content: input.content,
      postedAt: input.postedAt ?? new Date(),
      direction: "INBOUND",
    },
  });
  await afterNewInbound(conversationId);
}

export async function refreshAll(opts?: { limit?: number }): Promise<{ refreshed: number; errors: string[]; manual: number }> {
  const conversations = await prisma.conversation.findMany({
    where: {
      stage: { in: ["WAITING_FOR_RESPONSE", "ACTIVE_CONVERSATION", "FOLER_INTRODUCED", "WAITLIST_INVITED", "HELPING", "ENGAGED"] },
    },
    orderBy: { lastActivityAt: "asc" },
    take: opts?.limit ?? 20,
  });
  let refreshed = 0;
  let manual = 0;
  const errors: string[] = [];
  for (const c of conversations) {
    try {
      const res = await refreshConversation(c.id);
      if (res.ok) refreshed++;
      else {
        manual++;
        if (res.reason?.includes("RATE_LIMITED") || res.reason?.includes("429")) break;
      }
    } catch (err) {
      if (err instanceof RedditProviderError && err.kind === "RATE_LIMITED") break;
      errors.push(`${c.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { refreshed, manual, errors };
}
