import { STRUGGLE_TAGS, type StruggleTag } from "./taxonomy";

export interface StruggleEvidence {
  tag: StruggleTag;
  quote: string;
  /** Set only after human review: the label was confirmed, corrected from a wrong engine label
   *  (same quote), or added because the engine missed it. */
  human?: "confirmed" | "corrected" | "added";
}

const TAG_SET = new Set<string>(STRUGGLE_TAGS);

export function parseEvidence(raw: unknown): StruggleEvidence[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is { tag: string; quote: string } => !!e && typeof e === "object" && typeof (e as { tag?: unknown }).tag === "string")
    .map((e) => ({ tag: e.tag as StruggleTag, quote: String(e.quote ?? "") }));
}

export const MAX_STRUGGLE_TAGS = 3;

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9'%\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function bigrams(ws: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 2 <= ws.length; i++) out.add(ws[i] + " " + ws[i + 1]);
  return out;
}

/**
 * Does `quote` actually occur in `text`? Exact match after normalisation, or ≥70% of
 * the quote's word pairs appear in the text (tolerates ellipses and small paraphrase).
 * Quotes under three words never count: they are too easy to hallucinate.
 */
export function quoteAppears(quote: string, text: string): boolean {
  const q = words(quote);
  if (q.length < 3) return false;
  const t = words(text);
  const tj = " " + t.join(" ") + " ";
  if (tj.includes(" " + q.join(" ") + " ")) return true;
  const tb = bigrams(t);
  const qb = bigrams(q);
  let hit = 0;
  for (const b of qb) if (tb.has(b)) hit++;
  return hit / qb.size >= 0.7;
}

const NEG = "(?:no|not|zero|never|none|didn'?t|did not|haven'?t|have not|hasn'?t|has not|without|nor|free of|thankfully|luckily|fortunately)";
/** A risk they might get, not something they have: "there's a chance of…", "it can cause…". */
const HYPOTHETICAL = /\b(?:(?:a |the |small |slight |low )?(?:chance|risk|possibility|potential|likelihood) of|(?:can|could|might|may|will) (?:cause|give|lead to|result in|include)|possible side)\b/i;
/** Someone else's words or a question to others, not this person's own case. */
const OTHERS_WORDS = /\b(?:he|she|they|doctor|derm(?:atologist)?|dr\.?|gp|physician|my (?:mom|mum|dad|wife|husband|partner|friend)) (?:thinks?|said|says|believes?|told me|mentioned|suggested|reckons?)\b|\b(?:did|do|does|have|has|has anyone|did anyone) (?:you|anyone|anybody|any of you)\b/i;
const DENIAL: Partial<Record<StruggleTag, RegExp[]>> = {
  SIDE_EFFECTS: [
    new RegExp(`\\b${NEG}\\b[^.?!]{0,40}\\bside[- ]?effects?\\b`, "i"),
    /\bside[- ]?effects?\b[^.?!]{0,20}\b(none|at all|whatsoever|zero|free)\b/i,
    new RegExp(`\\b${NEG}\\b[^.?!]{0,30}\\b(?:sides|sexual sides|issues with (?:libido|erections?))\\b`, "i"),
    /\b(?:going|all|everything(?:'s| is)|so far(?:,)? so) (?:smooth(?:ly)?|good|fine|well|great|ok(?:ay)?)\b|\bno (?:issues|problems|complaints)\b/i,
    /\b(?:minimi[sz]e|avoid|prevent|reduce|lower the (?:risk|chance) of) (?:the |any |potential |possible )?side[- ]?effects?\b/i,
    HYPOTHETICAL,
    OTHERS_WORDS,
  ],
  COST: [/\b(?:can|could) afford\b(?![^.?!]{0,20}\bnot\b)/i, /\bcost (?:isn'?t|is not|wasn'?t) (?:an issue|a problem|a concern)\b/i],
  EMOTIONAL_DISTRESS: [
    /\b(?:not|never) (?:too |that |really )?(?:worried|anxious|stressed|bothered|depressed)\b/i,
    /\b(?:due to|caused by|because of|down to|related to|linked to|triggered by|blam\w+ (?:it )?on|result of) (?:the |my |chronic |general )?(?:stress|anxiety|depression)\b/i,
    /\b(?:generally|naturally|always been|kind of|a bit of|quite) (?:an? )?(?:generally )?anxious(?: person)?\b/i,
    HYPOTHETICAL,
    OTHERS_WORDS,
  ],
  PRODUCT_CHOICE: [/\bif you(?:'re| are)\b|\b(?:anyone|those|people) (?:who(?:'s| is| are)|that(?:'s| is| are)) (?:thinking|considering|debating|on the fence)\b|\bmy advice\b/i],
};

/** The quote says the opposite of the struggle ("no side effects", "thankfully none"), or it is not this person's own current case. */
export function quoteDenies(tag: StruggleTag, quote: string): boolean {
  return (DENIAL[tag] ?? []).some((re) => re.test(quote));
}

/**
 * Keep only tags that are known and backed by a quote found in the thread.
 * Deduplicates, drops OTHER when a real tag survives, caps at MAX_STRUGGLE_TAGS.
 */
export function validateStruggles(
  raw: { tag?: unknown; quote?: unknown }[] | undefined,
  threadText: string,
): { tags: StruggleTag[]; evidence: StruggleEvidence[]; dropped: { tag: string; quote: string; why: string }[] } {
  const evidence: StruggleEvidence[] = [];
  const dropped: { tag: string; quote: string; why: string }[] = [];
  const seen = new Set<string>();
  for (const item of raw ?? []) {
    const tag = String(item?.tag ?? "").trim().toUpperCase();
    const quote = String(item?.quote ?? "").trim();
    if (!TAG_SET.has(tag)) {
      dropped.push({ tag, quote, why: "unknown tag" });
      continue;
    }
    if (seen.has(tag)) continue;
    if (!quoteAppears(quote, threadText)) {
      dropped.push({ tag, quote, why: "quote not found in thread" });
      continue;
    }
    if (quoteDenies(tag as StruggleTag, quote)) {
      dropped.push({ tag, quote, why: "quote denies the problem" });
      continue;
    }
    seen.add(tag);
    evidence.push({ tag: tag as StruggleTag, quote });
    if (evidence.length >= MAX_STRUGGLE_TAGS) break;
  }
  const real = evidence.filter((e) => e.tag !== "OTHER");
  const kept = real.length ? real : evidence;
  return { tags: kept.map((e) => e.tag), evidence: kept, dropped };
}
