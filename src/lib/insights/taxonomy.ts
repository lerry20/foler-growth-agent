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
