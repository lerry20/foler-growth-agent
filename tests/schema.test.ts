import { describe, expect, it } from "vitest";
import { AnalysisSchema } from "@/lib/ai/schema";

const base = {
  intent: "TREATMENT_JOURNEY",
  foler_relevance: 40,
  conversation_opportunity: 40,
  conversion_potential: 10,
  recommended_action: "HELP",
  should_mention_foler: false,
  permission_signal: "NONE",
  scores: { problem_relevance: 10, measurement_intent: 5, treatment_journey: 10, conversation_opportunity: 5, product_intent: 0 },
};

describe("AnalysisSchema enums", () => {
  it("keeps valid values", () => {
    expect(AnalysisSchema.parse(base).intent).toBe("TREATMENT_JOURNEY");
  });

  it("maps invented enum values to the safe default instead of failing the analysis", () => {
    const a = AnalysisSchema.parse({
      ...base,
      intent: "SEEKING_ADVICE",
      recommended_action: "reply-kindly",
      permission_signal: "maybe",
    });
    expect(a.intent).toBe("OTHER");
    expect(a.recommended_action).toBe("IGNORE");
    expect(a.permission_signal).toBe("NONE");
  });

  it("normalises casing and separators", () => {
    expect(AnalysisSchema.parse({ ...base, intent: "hair problem" }).intent).toBe("HAIR_PROBLEM");
  });
});
