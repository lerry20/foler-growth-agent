import type { Intent } from "@prisma/client";

export const INTENTS: Intent[] = ["MEASUREMENT", "UNCERTAINTY", "TREATMENT_JOURNEY", "HAIR_PROBLEM", "PRODUCT_INTENT", "OTHER"];

export const INTENT_LABEL: Record<Intent, string> = {
  MEASUREMENT: "wants to measure progress",
  UNCERTAINTY: "unsure if treatment works",
  TREATMENT_JOURNEY: "sharing their treatment journey",
  HAIR_PROBLEM: "describing a hair problem",
  PRODUCT_INTENT: "looking for a product",
  OTHER: "other",
};
