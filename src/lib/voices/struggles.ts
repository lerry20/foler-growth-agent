import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { analyzeWithAnthropic } from "@/lib/ai/anthropic";
import { struggleRulesText } from "@/lib/insights/taxonomy";
import { validateStruggles, type StruggleEvidence } from "@/lib/insights/evidence";
import { verifyStruggles } from "@/lib/insights/verify";
import { correctionsText } from "@/lib/insights/labelReview";
import { effective, isCounted } from "./review";
import { splitVoices, type VoiceDraft } from "./split";

export const LABEL_VERSION = "labels-v1";

export interface LabelContext {
  title: string;
  subreddit: string;
  /** Original post, shown as context when labelling a commenter; never a source of quotes. */
  opText: string;
  /** Human-reviewed mistakes rendered by `correctionsText`. */
  corrections: string;
}

export interface LabelResult {
  evidence: StruggleEvidence[];
  dropped: { tag: string; quote: string; why: string }[];
  /** "anthropic" when the model answered; "none" when it could not (the voice stays unlabelled). */
  provider: "anthropic" | "none";
}

const SYSTEM =
  "You read online health conversations the way a careful clinician-researcher would: literally, in context, without guessing. You label ONE participant's own struggles and answer only with JSON.";

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function labelPrompt(voice: VoiceDraft, ctx: LabelContext): string {
  const who = voice.role === "OP" ? "the ORIGINAL POSTER" : "a COMMENTER replying in the thread";
  const context =
    voice.role === "OP"
      ? ""
      : `\nORIGINAL POST (context only — never quote it, it is someone else's words):\n"""\n${clip(ctx.opText, 1500)}\n"""\n`;
  return `Community: r/${ctx.subreddit}
Thread title: ${ctx.title}
${context}
PARTICIPANT: u/${voice.author}, ${who}. Everything they wrote in this thread:
"""
${clip(voice.text, 4000)}
"""

Which struggles is THIS participant having right now, in their own words?

${struggleRulesText()}
${ctx.corrections ? `\n${ctx.corrections}\n` : ""}
For each struggle give the exact verbatim sentence from the PARTICIPANT's text that proves it (copy it character for character; it must appear in their text, not in the original post) and a one-line reason. Up to 3, usually 1, often none.

Return JSON only:
{"struggles":[{"tag":"<TAG>","quote":"<verbatim>","why":"<one line>"}]}`;
}

function parse(raw: unknown): { tag?: unknown; quote?: unknown }[] | null {
  if (!raw || typeof raw !== "object") return null;
  const list = (raw as { struggles?: unknown }).struggles;
  if (!Array.isArray(list)) return null;
  return list.filter((x): x is { tag?: unknown; quote?: unknown } => !!x && typeof x === "object");
}

/**
 * Label one voice's struggles from its own words only. Quotes are validated against the voice
 * text (not the thread), denials are rejected, then the quote-only judge gives a second opinion.
 */
export async function labelVoice(voice: VoiceDraft, ctx: LabelContext): Promise<LabelResult> {
  if (!env.ANTHROPIC_API_KEY) return { evidence: [], dropped: [], provider: "none" };
  let raw: unknown;
  try {
    raw = await analyzeWithAnthropic(SYSTEM, labelPrompt(voice, ctx), { temperature: 0, maxTokens: 700 });
  } catch {
    return { evidence: [], dropped: [], provider: "none" };
  }
  const list = parse(raw);
  if (!list) return { evidence: [], dropped: [], provider: "none" };
  const validated = validateStruggles(list, voice.text);
  const judged = await verifyStruggles(validated.evidence);
  return { evidence: judged.kept, dropped: [...validated.dropped, ...judged.dropped], provider: "anthropic" };
}

export interface LabelRunResult {
  labeled: number;
  withStruggles: number;
  /** Voices the model could not label; they stay unlabelled and are retried next run. */
  undecided: number;
}

async function loadCorrections(): Promise<string> {
  return correctionsText(
    await prisma.struggleReview.findMany({
      where: { verdict: "WRONG", quote: { not: "" } },
      orderBy: { updatedAt: "desc" },
      take: 25,
      select: { tag: true, verdict: true, shouldBe: true, quote: true, note: true },
    }),
  );
}

/**
 * Label the struggles of commenters who count as a person (own case, in scope — by model or
 * human verdict) and have not been labelled yet. Original posters are covered by the
 * conversation analysis, whose labels carry the human Audit verdicts.
 */
export async function labelVoices(opts?: { limit?: number; conversationId?: string }): Promise<LabelRunResult> {
  const limit = opts?.limit ?? 50;
  const result: LabelRunResult = { labeled: 0, withStruggles: 0, undecided: 0 };
  if (!env.ANTHROPIC_API_KEY) return result;

  const candidates = await prisma.voice.findMany({
    where: {
      role: "COMMENTER",
      labeledAt: null,
      ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
      conversation: { source: { not: "MOCK" }, lead: { isMock: false } },
      OR: [{ speaksAbout: "OWN_CASE", inScope: true }, { review: { speaksAbout: "OWN_CASE", inScope: true } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    include: {
      review: { select: { speaksAbout: true, inScope: true } },
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
  if (!candidates.length) return result;
  const corrections = await loadCorrections();

  let consecutiveUndecided = 0;
  for (const v of candidates) {
    if (consecutiveUndecided >= 3) break;
    if (!isCounted(effective(v))) continue;
    const draft = splitVoices(v.conversation.messages).find((d) => d.author.toLowerCase() === v.author.toLowerCase());
    if (!draft) continue;
    const op = v.conversation.messages.find((m) => m.isOriginalPost);
    const r = await labelVoice(draft, {
      title: v.conversation.title,
      subreddit: v.conversation.subreddit,
      opText: op?.content ?? "",
      corrections,
    });
    if (r.provider === "none") {
      result.undecided++;
      consecutiveUndecided++;
      continue;
    }
    consecutiveUndecided = 0;
    await prisma.voice.update({
      where: { id: v.id },
      data: {
        struggleEvidence: r.evidence.map((e) => ({ tag: e.tag, quote: e.quote })),
        labelProvider: r.provider,
        labeledAt: new Date(),
        classifierVersion: LABEL_VERSION,
      },
    });
    result.labeled++;
    if (r.evidence.length) result.withStruggles++;
  }
  return result;
}
