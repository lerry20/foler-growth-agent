import type { Intent, StruggleVerdict } from "@prisma/client";
import { prisma } from "@/lib/db";
import { STRUGGLE_TAGS, STRUGGLE_LABELS, type StruggleTag } from "./taxonomy";
import type { StruggleEvidence } from "./evidence";
import { parseEvidence } from "./evidence";

/** `shouldBe` on a WRONG verdict: what the quote really shows — another tag, or NONE (no struggle). */
export type LabelReview = { tag: string; verdict: StruggleVerdict; shouldBe?: string | null };

export const NO_STRUGGLE = "NONE";

const TAG_SET = new Set<string>(STRUGGLE_TAGS);

export function isStruggleTag(t: string): t is StruggleTag {
  return TAG_SET.has(t);
}

/** Struggle labels after human review: WRONG removes an engine label (and adds what it should have
 *  been, with the same quote), MISSED adds one. */
export function applyLabelReviews(
  evidence: StruggleEvidence[],
  reviews: LabelReview[],
): { tags: StruggleTag[]; evidence: StruggleEvidence[]; human: boolean } {
  const byTag = new Map(reviews.map((r) => [r.tag, r]));
  const verdict = (t: string) => byTag.get(t)?.verdict;
  const kept: StruggleEvidence[] = evidence
    .filter((e) => verdict(e.tag) !== "WRONG")
    .map((e) => (verdict(e.tag) === "RIGHT" ? { ...e, human: "confirmed" } : e));
  const has = (t: string) => kept.some((e) => e.tag === t);
  for (const r of reviews) {
    if (r.verdict !== "WRONG" || !r.shouldBe || !isStruggleTag(r.shouldBe) || has(r.shouldBe) || verdict(r.shouldBe) === "WRONG") continue;
    const quote = evidence.find((e) => e.tag === r.tag)?.quote ?? "";
    kept.push({ tag: r.shouldBe, quote, human: "corrected" });
  }
  for (const r of reviews) {
    if (r.verdict !== "MISSED" || !isStruggleTag(r.tag) || has(r.tag)) continue;
    kept.push({ tag: r.tag, quote: "", human: "added" });
  }
  return { tags: kept.map((e) => e.tag), evidence: kept, human: reviews.length > 0 };
}

export function scoreLabels(reviews: LabelReview[]) {
  const right = reviews.filter((r) => r.verdict === "RIGHT").length;
  const wrong = reviews.filter((r) => r.verdict === "WRONG").length;
  const missed = reviews.filter((r) => r.verdict === "MISSED").length;
  const corrected = reviews.filter((r) => r.verdict === "WRONG" && r.shouldBe && r.shouldBe !== NO_STRUGGLE).length;
  const perTag = new Map<string, { tag: string; right: number; wrong: number; missed: number; shouldBe: Record<string, number> }>();
  for (const r of reviews) {
    const e = perTag.get(r.tag) ?? { tag: r.tag, right: 0, wrong: 0, missed: 0, shouldBe: {} };
    if (r.verdict === "RIGHT") e.right++;
    else if (r.verdict === "WRONG") {
      e.wrong++;
      if (r.shouldBe) e.shouldBe[r.shouldBe] = (e.shouldBe[r.shouldBe] ?? 0) + 1;
    } else e.missed++;
    perTag.set(r.tag, e);
  }
  return {
    reviewed: reviews.length,
    right,
    wrong,
    missed,
    /** WRONG verdicts where you said which other struggle it really is. */
    corrected,
    /** Of the labels the engine gave that you judged, the share that were right. */
    precision: right + wrong ? right / (right + wrong) : null,
    perTag: [...perTag.values()].sort((a, b) => b.wrong + b.missed - (a.wrong + a.missed)),
  };
}

export type CorrectionExample = { tag: string; verdict: StruggleVerdict; shouldBe: string | null; quote: string; note: string };

/** Human corrections rendered as worked examples for the classifier prompt. */
export function correctionsText(examples: CorrectionExample[]): string {
  const name = (t: string) => (isStruggleTag(t) ? `${t} (${STRUGGLE_LABELS[t]})` : t);
  const lines = examples
    .filter((e) => e.verdict === "WRONG" && e.quote)
    .map((e) => {
      const fix = !e.shouldBe ? "not this struggle" : e.shouldBe === NO_STRUGGLE ? "NO struggle tag at all" : name(e.shouldBe);
      return `- "${e.quote}" → NOT ${name(e.tag)}; correct: ${fix}.${e.note ? ` Reviewer: ${e.note}` : ""}`;
    });
  return lines.length ? `HUMAN-REVIEWED MISTAKES TO AVOID (verbatim quotes the engine mislabelled before):\n${lines.join("\n")}` : "";
}

export async function reviewLabel(conversationId: string, tag: StruggleTag, verdict: StruggleVerdict, shouldBe?: string | null) {
  const c = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { struggleEvidence: true, analysisProvider: true },
  });
  const engine = parseEvidence(c.struggleEvidence).find((e) => e.tag === tag);
  if (verdict === "MISSED" && engine) throw new Error("The engine already gave this label — judge it right or wrong instead.");
  if (verdict !== "MISSED" && !engine) throw new Error("The engine did not give this label here.");
  if (shouldBe && verdict !== "WRONG") throw new Error("Only a wrong label can be corrected to something else.");
  if (shouldBe && shouldBe !== NO_STRUGGLE && (!isStruggleTag(shouldBe) || shouldBe === tag)) throw new Error("Unknown correction");
  const snapshot = { quote: engine?.quote ?? "", modelProvider: engine ? c.analysisProvider : null, shouldBe: verdict === "WRONG" ? (shouldBe ?? null) : null };
  return prisma.struggleReview.upsert({
    where: { conversationId_tag: { conversationId, tag } },
    create: { conversationId, tag, verdict, ...snapshot },
    update: { verdict, ...snapshot },
  });
}

export async function noteLabel(conversationId: string, tag: string, note: string) {
  return prisma.struggleReview.update({ where: { conversationId_tag: { conversationId, tag } }, data: { note: note.trim().slice(0, 500) } });
}

export async function clearLabelReview(conversationId: string, tag: string) {
  await prisma.struggleReview.deleteMany({ where: { conversationId, tag } });
}

export async function reviewIntent(conversationId: string, intent: Intent, note = "") {
  const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { lead: { select: { intent: true } } } });
  const modelIntent = c.lead.intent;
  return prisma.intentReview.upsert({
    where: { conversationId },
    create: { conversationId, intent, modelIntent, note },
    update: { intent, modelIntent, note },
  });
}

export async function clearIntentReview(conversationId: string) {
  await prisma.intentReview.deleteMany({ where: { conversationId } });
}
