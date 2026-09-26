import { prisma } from "@/lib/db";
import { splitVoices } from "./split";
import { gateVoice } from "./gate";

/**
 * Bring the Voice rows of a conversation in line with its messages: one row per inbound author.
 * A voice whose set of messages changed (the author wrote more) is reset so it gets gated again.
 */
export async function syncVoices(conversationId: string): Promise<{ created: number; changed: number }> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    select: { id: true, author: true, content: true, postedAt: true, direction: true, isOriginalPost: true },
  });
  const drafts = splitVoices(messages);
  const existing = await prisma.voice.findMany({
    where: { conversationId },
    select: { id: true, author: true, messageIds: true },
  });
  const byAuthor = new Map(existing.map((v) => [v.author.toLowerCase(), v]));

  let created = 0;
  let changed = 0;
  for (const d of drafts) {
    const cur = byAuthor.get(d.author.toLowerCase());
    if (!cur) {
      await prisma.voice.create({
        data: {
          conversationId,
          author: d.author,
          role: d.role,
          messageIds: d.messageIds,
          wordCount: d.wordCount,
        },
      });
      created++;
      continue;
    }
    const same =
      cur.messageIds.length === d.messageIds.length && d.messageIds.every((id) => cur.messageIds.includes(id));
    if (same) continue;
    await prisma.voice.update({
      where: { id: cur.id },
      data: {
        role: d.role,
        messageIds: d.messageIds,
        wordCount: d.wordCount,
        speaksAbout: null,
        inScope: null,
        minor: null,
        gateWhy: "",
        gateProvider: null,
        gatedAt: null,
        needsReview: false,
      },
    });
    changed++;
  }
  return { created, changed };
}

export interface GateRunResult {
  gated: number;
  ownCase: number;
  unclear: number;
  /** Voices decided without the model (no key / API error); they sit in the review queue. */
  undecided: number;
}

/**
 * Run the relevance gate on voices that have not been judged yet (or were reset).
 * Voices the model could not judge stay UNCLEAR with needsReview so a human decides.
 */
export async function gateVoices(opts?: { limit?: number; conversationId?: string }): Promise<GateRunResult> {
  const limit = opts?.limit ?? 50;
  const result: GateRunResult = { gated: 0, ownCase: 0, unclear: 0, undecided: 0 };

  const pending = await prisma.voice.findMany({
    where: {
      gatedAt: null,
      ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
      conversation: { source: { not: "MOCK" }, lead: { isMock: false } },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    include: {
      conversation: {
        select: {
          title: true,
          subreddit: true,
          messages: {
            select: { id: true, author: true, content: true, postedAt: true, direction: true, isOriginalPost: true },
          },
        },
      },
    },
  });

  let consecutiveUndecided = 0;
  for (const v of pending) {
    if (consecutiveUndecided >= 3) break;
    const drafts = splitVoices(v.conversation.messages);
    const draft = drafts.find((d) => d.author.toLowerCase() === v.author.toLowerCase());
    if (!draft) continue;
    const op = v.conversation.messages.find((m) => m.isOriginalPost);
    const gate = await gateVoice(draft, {
      title: v.conversation.title,
      subreddit: v.conversation.subreddit,
      opText: op?.content ?? "",
    });
    const undecided = gate.provider === "none";
    await prisma.voice.update({
      where: { id: v.id },
      data: {
        speaksAbout: gate.speaksAbout,
        inScope: gate.inScope,
        minor: gate.minor,
        gateWhy: gate.why,
        gateProvider: gate.provider,
        gatedAt: undecided ? null : new Date(),
        needsReview: gate.speaksAbout === "UNCLEAR",
      },
    });
    result.gated++;
    consecutiveUndecided = undecided ? consecutiveUndecided + 1 : 0;
    if (gate.speaksAbout === "OWN_CASE") result.ownCase++;
    if (gate.speaksAbout === "UNCLEAR") result.unclear++;
    if (undecided) result.undecided++;
  }
  return result;
}
