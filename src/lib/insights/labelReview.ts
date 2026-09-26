import type { StruggleVerdict } from "@prisma/client";
import { prisma } from "@/lib/db";
import { STRUGGLE_TAGS, type StruggleTag } from "./taxonomy";
import type { StruggleEvidence } from "./evidence";
import { parseEvidence } from "./evidence";

export type LabelReview = { tag: string; verdict: StruggleVerdict };

const TAG_SET = new Set<string>(STRUGGLE_TAGS);

export function isStruggleTag(t: string): t is StruggleTag {
  return TAG_SET.has(t);
}

/** Struggle labels after human review: WRONG removes an engine label, MISSED adds one. */
export function applyLabelReviews(
  evidence: StruggleEvidence[],
  reviews: LabelReview[],
): { tags: StruggleTag[]; evidence: StruggleEvidence[]; human: boolean } {
  const byTag = new Map(reviews.map((r) => [r.tag, r.verdict]));
  const kept: StruggleEvidence[] = evidence
    .filter((e) => byTag.get(e.tag) !== "WRONG")
    .map((e) => (byTag.get(e.tag) === "RIGHT" ? { ...e, human: "confirmed" } : e));
  const added: StruggleEvidence[] = reviews
    .filter((r) => r.verdict === "MISSED" && isStruggleTag(r.tag) && !kept.some((e) => e.tag === r.tag))
    .map((r) => ({ tag: r.tag as StruggleTag, quote: "", human: "added" }));
  const all = [...kept, ...added];
  return { tags: all.map((e) => e.tag), evidence: all, human: reviews.length > 0 };
}

export function scoreLabels(reviews: LabelReview[]) {
  const right = reviews.filter((r) => r.verdict === "RIGHT").length;
  const wrong = reviews.filter((r) => r.verdict === "WRONG").length;
  const missed = reviews.filter((r) => r.verdict === "MISSED").length;
  const perTag = new Map<string, { tag: string; right: number; wrong: number; missed: number }>();
  for (const r of reviews) {
    const e = perTag.get(r.tag) ?? { tag: r.tag, right: 0, wrong: 0, missed: 0 };
    if (r.verdict === "RIGHT") e.right++;
    else if (r.verdict === "WRONG") e.wrong++;
    else e.missed++;
    perTag.set(r.tag, e);
  }
  return {
    reviewed: reviews.length,
    right,
    wrong,
    missed,
    /** Of the labels the engine gave that you judged, the share that were right. */
    precision: right + wrong ? right / (right + wrong) : null,
    perTag: [...perTag.values()].sort((a, b) => b.wrong + b.missed - (a.wrong + a.missed)),
  };
}

export async function reviewLabel(conversationId: string, tag: StruggleTag, verdict: StruggleVerdict) {
  const c = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { struggleEvidence: true, analysisProvider: true },
  });
  const engine = parseEvidence(c.struggleEvidence).find((e) => e.tag === tag);
  if (verdict === "MISSED" && engine) throw new Error("The engine already gave this label — judge it right or wrong instead.");
  if (verdict !== "MISSED" && !engine) throw new Error("The engine did not give this label here.");
  const snapshot = { quote: engine?.quote ?? "", modelProvider: engine ? c.analysisProvider : null };
  return prisma.struggleReview.upsert({
    where: { conversationId_tag: { conversationId, tag } },
    create: { conversationId, tag, verdict, ...snapshot },
    update: { verdict, ...snapshot },
  });
}

export async function clearLabelReview(conversationId: string, tag: string) {
  await prisma.struggleReview.deleteMany({ where: { conversationId, tag } });
}
