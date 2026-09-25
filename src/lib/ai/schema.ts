import { z } from "zod";

const clamp = (min: number, max: number) =>
  z.number().transform((v) => Math.max(min, Math.min(max, Math.round(Number.isFinite(v) ? v : 0))));

export const AnalysisSchema = z.object({
  problem: z.string().default(""),
  hair_concern: z.string().default(""),
  treatment: z.string().default(""),
  treatment_duration: z.string().default(""),
  problem_theme: z.string().default(""),
  struggle_tags: z.array(z.string()).default([]),
  struggle_evidence: z
    .array(z.object({ tag: z.string().default(""), quote: z.string().default("") }))
    .default([]),
  unmet_need: z.string().default(""),
  intent: z.enum(["MEASUREMENT", "UNCERTAINTY", "TREATMENT_JOURNEY", "HAIR_PROBLEM", "PRODUCT_INTENT", "OTHER"]),
  foler_relevance: clamp(0, 100),
  conversation_opportunity: clamp(0, 100),
  conversion_potential: clamp(0, 100),
  recommended_action: z.enum(["IGNORE", "HELP", "ENGAGE", "FOLLOW_UP", "DM", "INTRODUCE_FOLER", "WAITLIST_INVITE"]),
  should_mention_foler: z.boolean(),
  permission_signal: z.enum(["NONE", "PERMISSION_GRANTED", "INTEREST_EXPRESSED", "ALREADY_SIGNED_UP", "DECLINED"]),
  reason: z.string().default(""),
  suggested_response: z.string().default(""),
  scores: z.object({
    problem_relevance: clamp(0, 30),
    measurement_intent: clamp(0, 25),
    treatment_journey: clamp(0, 15),
    conversation_opportunity: clamp(0, 15),
    product_intent: clamp(0, 10),
  }),
});
