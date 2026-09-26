import { z } from "zod";

const clamp = (min: number, max: number) =>
  z.number().transform((v) => Math.max(min, Math.min(max, Math.round(Number.isFinite(v) ? v : 0))));

/** An enum where any value the model invents falls back to `other` instead of failing the whole analysis. */
const lenientEnum = <const T extends readonly [string, ...string[]]>(values: T, other: T[number]) =>
  z.preprocess((v) => {
    const s = String(v ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
    return (values as readonly string[]).includes(s) ? s : other;
  }, z.enum(values));

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
  intent: lenientEnum(["MEASUREMENT", "UNCERTAINTY", "TREATMENT_JOURNEY", "HAIR_PROBLEM", "PRODUCT_INTENT", "OTHER"], "OTHER"),
  foler_relevance: clamp(0, 100),
  conversation_opportunity: clamp(0, 100),
  conversion_potential: clamp(0, 100),
  recommended_action: lenientEnum(["IGNORE", "HELP", "ENGAGE", "FOLLOW_UP", "DM", "INTRODUCE_FOLER", "WAITLIST_INVITE"], "IGNORE"),
  should_mention_foler: z.boolean(),
  permission_signal: lenientEnum(["NONE", "PERMISSION_GRANTED", "INTEREST_EXPRESSED", "ALREADY_SIGNED_UP", "DECLINED"], "NONE"),
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
