import { STRUGGLE_TAGS, type StruggleTag } from "./taxonomy";

export interface StruggleEvidence {
  tag: StruggleTag;
  quote: string;
}

const TAG_SET = new Set<string>(STRUGGLE_TAGS);
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
    seen.add(tag);
    evidence.push({ tag: tag as StruggleTag, quote });
    if (evidence.length >= MAX_STRUGGLE_TAGS) break;
  }
  const real = evidence.filter((e) => e.tag !== "OTHER");
  const kept = real.length ? real : evidence;
  return { tags: kept.map((e) => e.tag), evidence: kept, dropped };
}
