import type { SpeaksAbout } from "@prisma/client";
import { prisma } from "@/lib/db";

export { SPEAKS_ABOUT_LABELS } from "./labels";

/** Counts as a person in Insights: own case, in scope. */
export function isCounted(v: { speaksAbout: SpeaksAbout | null; inScope: boolean | null }) {
  return v.speaksAbout === "OWN_CASE" && v.inScope === true;
}

/** The human verdict wins over the model when both exist. */
export function effective<V extends { speaksAbout: SpeaksAbout | null; inScope: boolean | null; review: { speaksAbout: SpeaksAbout; inScope: boolean } | null }>(
  v: V
): { speaksAbout: SpeaksAbout | null; inScope: boolean | null; source: "human" | "model" | "none" } {
  if (v.review) return { speaksAbout: v.review.speaksAbout, inScope: v.review.inScope, source: "human" };
  if (v.speaksAbout) return { speaksAbout: v.speaksAbout, inScope: v.inScope, source: "model" };
  return { speaksAbout: null, inScope: null, source: "none" };
}

export async function reviewVoice(voiceId: string, verdict: { speaksAbout: SpeaksAbout; inScope: boolean; note?: string }) {
  const voice = await prisma.voice.findUnique({
    where: { id: voiceId },
    select: { speaksAbout: true, inScope: true, gateProvider: true },
  });
  if (!voice) throw new Error("Voice not found");
  const review = await prisma.voiceReview.upsert({
    where: { voiceId },
    create: {
      voiceId,
      speaksAbout: verdict.speaksAbout,
      inScope: verdict.inScope,
      note: verdict.note ?? "",
      modelSpeaksAbout: voice.speaksAbout,
      modelInScope: voice.inScope,
      modelProvider: voice.gateProvider,
    },
    update: {
      speaksAbout: verdict.speaksAbout,
      inScope: verdict.inScope,
      note: verdict.note ?? "",
    },
  });
  await prisma.voice.update({ where: { id: voiceId }, data: { needsReview: false } });
  return review;
}

export async function clearReview(voiceId: string) {
  await prisma.voiceReview.deleteMany({ where: { voiceId } });
}

export interface GateScore {
  /** Human-reviewed voices. */
  reviewed: number;
  /** …of which the model had also decided (so they can be compared). */
  compared: number;
  agree: number;
  /** Exact category agreement on compared voices. */
  accuracy: number | null;
  /** "Counts as a person" (own case + in scope): model vs human. */
  counted: { tp: number; fp: number; fn: number; precision: number | null; recall: number | null };
  /** Model said X, human said Y (X ≠ Y). */
  confusions: { model: SpeaksAbout; human: SpeaksAbout; count: number }[];
}

/**
 * Score the model's gate against every human verdict. The model's decision is the one
 * stored on the review (snapshot at review time), so re-gating later doesn't rewrite history.
 */
export function scoreGate(
  reviews: { speaksAbout: SpeaksAbout; inScope: boolean; modelSpeaksAbout: SpeaksAbout | null; modelInScope: boolean | null }[]
): GateScore {
  const compared = reviews.filter((r) => r.modelSpeaksAbout !== null);
  let agree = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  const conf = new Map<string, { model: SpeaksAbout; human: SpeaksAbout; count: number }>();
  for (const r of compared) {
    const model = r.modelSpeaksAbout as SpeaksAbout;
    if (model === r.speaksAbout) agree++;
    else {
      const k = `${model}>${r.speaksAbout}`;
      const cur = conf.get(k);
      if (cur) cur.count++;
      else conf.set(k, { model, human: r.speaksAbout, count: 1 });
    }
    const m = isCounted({ speaksAbout: model, inScope: r.modelInScope });
    const h = isCounted(r);
    if (m && h) tp++;
    else if (m && !h) fp++;
    else if (!m && h) fn++;
  }
  const ratio = (a: number, b: number) => (b === 0 ? null : a / b);
  return {
    reviewed: reviews.length,
    compared: compared.length,
    agree,
    accuracy: ratio(agree, compared.length),
    counted: { tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) },
    confusions: [...conf.values()].sort((a, b) => b.count - a.count),
  };
}
