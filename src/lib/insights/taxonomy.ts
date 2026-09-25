export const STRUGGLE_TAGS = [
  "UNCERTAINTY_IF_WORKING","MEASUREMENT_TRACKING","SIDE_EFFECTS","COST","ACCESS_TO_CARE",
  "CONFLICTING_INFO","EMOTIONAL_DISTRESS","CONSISTENCY_ADHERENCE","DIAGNOSIS_UNCLEAR",
  "TIME_TO_RESULTS","PRODUCT_CHOICE","SOCIAL_STIGMA","OTHER",
] as const;
export type StruggleTag = typeof STRUGGLE_TAGS[number];
export const STRUGGLE_LABELS: Record<StruggleTag,string> = {
  UNCERTAINTY_IF_WORKING: "Can't tell if it's working",
  MEASUREMENT_TRACKING: "Hard to measure / track progress",
  SIDE_EFFECTS: "Side effects",
  COST: "Cost",
  ACCESS_TO_CARE: "Access to doctors / prescriptions",
  CONFLICTING_INFO: "Conflicting information",
  EMOTIONAL_DISTRESS: "Emotional distress",
  CONSISTENCY_ADHERENCE: "Staying consistent",
  DIAGNOSIS_UNCLEAR: "Unclear diagnosis / cause",
  TIME_TO_RESULTS: "Results take too long",
  PRODUCT_CHOICE: "Which product / protocol to choose",
  SOCIAL_STIGMA: "Social stigma",
  OTHER: "Other",
};

/** What each tag means, with explicit exclusions. Shared by every classifier prompt. */
export const STRUGGLE_RULES: Record<StruggleTag, string> = {
  UNCERTAINTY_IF_WORKING:
    "The person is ALREADY on a treatment and says they cannot tell whether it is having an effect (\"hard to know if fin is doing anything\", \"6 months in, not sure it's working\", \"no visible improvement after a year\"). NOT for people deciding whether to start, asking what to add, reporting clear results, or asking about side effects.",
  MEASUREMENT_TRACKING:
    "They explicitly struggle with HOW to judge change: photos, lighting, hair counts, comparing before/after, biomarkers vs visible result. Requires a mention of measuring/comparing/tracking, not merely being unsure.",
  SIDE_EFFECTS:
    "They report, fear or troubleshoot an adverse effect of a treatment they take or were prescribed (libido, ED, brain fog, shedding they attribute to the drug, scalp irritation, hypertrichosis). Not for the hair loss itself.",
  COST:
    "Price, affordability, insurance or budget is part of the problem.",
  ACCESS_TO_CARE:
    "Trouble getting a dermatologist, prescription, appointment, or reliable supply.",
  CONFLICTING_INFO:
    "They cite contradictory advice/studies/anecdotes and don't know what to believe. Not for ordinary 'which is better' questions without conflicting sources.",
  EMOTIONAL_DISTRESS:
    "Explicit anxiety, shame, hopelessness, depression, panic, 'ruining my life', crying, avoiding people. Not for ordinary mild worry.",
  CONSISTENCY_ADHERENCE:
    "Trouble keeping up the routine: forgetting doses, hating daily topicals, stopping and restarting, lifetime-commitment fatigue.",
  DIAGNOSIS_UNCLEAR:
    "They don't know WHAT is causing the hair loss (TE vs AGA, thyroid, stress, PCOS, 'is this normal shedding?') or whether it is hair loss at all.",
  TIME_TO_RESULTS:
    "They are on treatment and frustrated by how long results take, ask when to expect results, or worry it's too early/late. Requires a timeline concern; not the same as not knowing if it works.",
  PRODUCT_CHOICE:
    "Choosing between treatments, doses, forms, brands, or what to add/stack. Includes 'should I start X?' and 'topical vs oral?'.",
  SOCIAL_STIGMA:
    "Comments from others, dating, work, hiding it, feeling judged.",
  OTHER:
    "Use ONLY when nothing else fits and only alone.",
};

export function struggleRulesText(): string {
  return STRUGGLE_TAGS.map((t) => `- ${t}: ${STRUGGLE_RULES[t]}`).join("\n");
}
