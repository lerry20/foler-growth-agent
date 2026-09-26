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
  TIME_TO_RESULTS: "No / disappointing results",
  PRODUCT_CHOICE: "Which product / protocol to choose",
  SOCIAL_STIGMA: "Social stigma",
  OTHER: "Other",
};

/** What each tag means, with explicit exclusions. Shared by every classifier prompt. */
export const STRUGGLE_RULES: Record<StruggleTag, string> = {
  UNCERTAINTY_IF_WORKING:
    "The person is ALREADY on a treatment and explicitly says they cannot tell whether it is having an effect (\"hard to know if fin is doing anything\", \"6 months in, not sure it's working\", \"can't tell if these are new hairs\"). NOT for: deciding whether to start; asking what to add or switch to; asking whether pausing will undo progress; reporting a clear outcome either way (\"great results\", \"zero results\", \"kept losing ground\" = known outcome, not uncertainty; a bad outcome is TIME_TO_RESULTS); side-effect questions; general worry about the future.",
  MEASUREMENT_TRACKING:
    "They explicitly struggle with HOW to judge change: photos, lighting, hair counts, comparing before/after, biomarkers vs visible result. Requires a mention of measuring/comparing/tracking, not merely being unsure.",
  SIDE_EFFECTS:
    "They are CURRENTLY experiencing, or refusing/hesitating on a treatment because of, an adverse effect (libido, ED, brain fog, shedding they attribute to the drug, scalp irritation, hypertrichosis). NEVER when they say they have none (\"no side effects\", \"didn't experience any\", \"thankfully none\", \"going smooth\"), when they list POSSIBLE risks they do not have (\"there's a chance of sexual dysfunction\"), or when they ask others about theirs (\"did you notice side effects?\"). Not for the hair loss itself, and not for side effects of a drug they stopped years ago.",
  COST:
    "Price, affordability, insurance or budget is part of the problem.",
  ACCESS_TO_CARE:
    "Trouble getting a dermatologist, prescription, appointment, or reliable supply.",
  CONFLICTING_INFO:
    "They cite contradictory advice/studies/anecdotes and don't know what to believe. Not for ordinary 'which is better' questions without conflicting sources.",
  EMOTIONAL_DISTRESS:
    "Explicit anxiety, shame, hopelessness, depression, panic, 'ruining my life', crying, obsessive thinking, felt by this person now. Not for ordinary mild worry, being 'concerned', or wanting reassurance; not for stress/anxiety named as a CAUSE of the hair loss (\"he thinks it is due to stress and anxiety\"), a personality trait (\"I'm generally an anxious person\"), someone else's words, or a listed drug risk (\"severe depression\" as a possible side effect).",
  CONSISTENCY_ADHERENCE:
    "Trouble keeping up the routine: forgetting doses, hating daily topicals, stopping and restarting, lifetime-commitment fatigue.",
  DIAGNOSIS_UNCLEAR:
    "They don't know WHAT is causing the hair loss (TE vs AGA, thyroid, stress, PCOS, 'is this normal shedding?') or whether it is hair loss at all.",
  TIME_TO_RESULTS:
    "They are on (or finished) a treatment and the RESULTS are the problem: none or too few (\"a year on min, didn't experience any results\"), worse than hoped (\"still getting thinner on fin\", \"density worse than baseline\"), a shed that won't resolve (\"9 weeks in, no sign of the shed slowing\"), or they need expectations set (\"what should I expect\", \"how long until I see something\"). The outcome is visible to them and disappointing, or they ask what outcome/timeline to expect. NOT the same as UNCERTAINTY_IF_WORKING (there they cannot tell either way); not for acknowledging 'it's still early' without concern; not for happy progress reports.",
  PRODUCT_CHOICE:
    "THIS person is choosing between treatments, doses, forms, brands, how to layer/use them, or what to add/stack/switch to. Includes 'should I start X?', 'topical vs oral?', 'what's the best thing to take?', and asking others what to try or what worked for them ('what helped you?', 'what worked better for you, oral or topical?') — quote that question itself, even if they already have a prescription. Not for advice they give to others (\"if you're thinking about starting minoxidil, just buy it\").",
  SOCIAL_STIGMA:
    "Comments from others, dating, work, hiding it, feeling judged.",
  OTHER:
    "Use ONLY when nothing else fits and only alone.",
};

export const STRUGGLE_PRINCIPLE =
  "A struggle is something this person is having trouble with RIGHT NOW, stated in their own words. " +
  "Never count: denials (\"no side effects\"), past history (\"years ago I tried…\"), neutral facts, mild curiosity, " +
  "or words written by other commenters. List EVERY distinct struggle this person clearly states, each backed by " +
  "its own sentence — a person choosing between products AND upset about results has two struggles, not one. " +
  "Do not drop a clearly stated struggle because another one is stronger; do not add one that is only implied. " +
  "Usually 1–2, at most 3. Unsure whether a sentence really shows a struggle? Leave that one out.";

export function struggleRulesText(): string {
  return STRUGGLE_PRINCIPLE + "\n" + STRUGGLE_TAGS.map((t) => `- ${t}: ${STRUGGLE_RULES[t]}`).join("\n");
}
