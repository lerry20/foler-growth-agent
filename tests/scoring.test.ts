import { describe, expect, it } from "vitest";
import { categorize, normalizeBreakdown, recencyScore, totalScore } from "@/lib/scoring";

const base = {
  problemRelevance: 30,
  measurementIntent: 25,
  treatmentJourney: 15,
  conversationOpportunity: 15,
  productIntent: 10,
  recency: 5,
};

describe("scoring", () => {
  it("sums a full breakdown to 100", () => {
    expect(totalScore(base)).toBe(100);
  });
  it("clamps out-of-range values", () => {
    const n = normalizeBreakdown({ ...base, problemRelevance: 99, recency: -3, productIntent: 11 });
    expect(n.problemRelevance).toBe(30);
    expect(n.recency).toBe(0);
    expect(n.productIntent).toBe(10);
    expect(totalScore({ ...base, problemRelevance: 99, recency: -3, productIntent: 11 })).toBe(95);
  });
  it("categorizes by thresholds", () => {
    expect(categorize(70)).toBe("HOT");
    expect(categorize(45)).toBe("WARM");
    expect(categorize(20)).toBe("COLD");
    expect(categorize(19)).toBe("IGNORE");
  });
  it("recencyScore buckets by age", () => {
    const now = new Date();
    const h = (n: number) => new Date(now.getTime() - n * 36e5);
    expect(recencyScore(h(1), now)).toBe(5);
    expect(recencyScore(h(50), now)).toBe(4);
    expect(recencyScore(h(24 * 5), now)).toBe(3);
    expect(recencyScore(h(24 * 20), now)).toBe(2);
    expect(recencyScore(h(24 * 60), now)).toBe(1);
    expect(recencyScore(h(24 * 100), now)).toBe(0);
  });
});
