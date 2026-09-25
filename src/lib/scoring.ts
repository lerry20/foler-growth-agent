import type { LeadCategory } from "@prisma/client";

export interface ScoreBreakdown {
  problemRelevance: number; // 0-30
  measurementIntent: number; // 0-25
  treatmentJourney: number; // 0-15
  conversationOpportunity: number; // 0-15
  productIntent: number; // 0-10
  recency: number; // 0-5
}

const MAX: Record<keyof ScoreBreakdown, number> = {
  problemRelevance: 30,
  measurementIntent: 25,
  treatmentJourney: 15,
  conversationOpportunity: 15,
  productIntent: 10,
  recency: 5,
};

const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(Number.isFinite(v) ? v : 0)));

export function recencyScore(postedAt: Date, now: Date = new Date()): number {
  const ageHours = (now.getTime() - postedAt.getTime()) / 36e5;
  if (ageHours <= 24) return 5;
  if (ageHours <= 72) return 4;
  if (ageHours <= 24 * 7) return 3;
  if (ageHours <= 24 * 30) return 2;
  if (ageHours <= 24 * 90) return 1;
  return 0;
}

export function normalizeBreakdown(b: ScoreBreakdown): ScoreBreakdown {
  return {
    problemRelevance: clamp(b.problemRelevance, MAX.problemRelevance),
    measurementIntent: clamp(b.measurementIntent, MAX.measurementIntent),
    treatmentJourney: clamp(b.treatmentJourney, MAX.treatmentJourney),
    conversationOpportunity: clamp(b.conversationOpportunity, MAX.conversationOpportunity),
    productIntent: clamp(b.productIntent, MAX.productIntent),
    recency: clamp(b.recency, MAX.recency),
  };
}

export function totalScore(b: ScoreBreakdown): number {
  const n = normalizeBreakdown(b);
  return n.problemRelevance + n.measurementIntent + n.treatmentJourney + n.conversationOpportunity + n.productIntent + n.recency;
}

// Operational prioritisation only. Not a prediction.
export function categorize(total: number): LeadCategory {
  if (total >= 70) return "HOT";
  if (total >= 45) return "WARM";
  if (total >= 20) return "COLD";
  return "IGNORE";
}
