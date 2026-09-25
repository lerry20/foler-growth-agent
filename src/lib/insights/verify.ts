import { env } from "@/lib/env";
import { analyzeWithAnthropic } from "@/lib/ai/anthropic";
import { STRUGGLE_RULES, STRUGGLE_PRINCIPLE } from "./taxonomy";
import type { StruggleEvidence } from "./evidence";

export interface VerifyResult {
  kept: StruggleEvidence[];
  dropped: { tag: string; quote: string; why: string }[];
  /** false when the judge could not run (no key / API error) and everything was kept as-is. */
  judged: boolean;
}

/**
 * Second opinion on each (tag, quote) pair, seen in isolation from the rest of the thread.
 * The first pass reads the whole post and tends to over-tag from context; the judge only sees
 * the quote and the tag's rule, so a quote has to carry the struggle on its own to survive.
 */
export async function verifyStruggles(evidence: StruggleEvidence[]): Promise<VerifyResult> {
  if (!evidence.length) return { kept: [], dropped: [], judged: true };
  if (!env.ANTHROPIC_API_KEY) return { kept: evidence, dropped: [], judged: false };

  const items = evidence
    .map((e, i) => `${i}. TAG ${e.tag}\n   RULE: ${STRUGGLE_RULES[e.tag]}\n   QUOTE: "${e.quote}"`)
    .join("\n\n");
  const user = `You audit a health-listening classifier. For each item decide whether the QUOTE, read on its own, is clear evidence that the writer is currently struggling with the TAG as defined by its RULE.

${STRUGGLE_PRINCIPLE}

Say "drop" when the quote: denies the problem, describes the past, states a neutral fact, expresses only mild curiosity, fits the RULE's exclusions, or would need surrounding context to count.

${items}

Return JSON only: {"verdicts":[{"i":0,"verdict":"keep"|"drop","why":"<8 words"}]}`;

  try {
    const raw = (await analyzeWithAnthropic(
      "You are a strict, literal auditor. Precision matters more than recall.",
      user,
      { temperature: 0, maxTokens: 600 },
    )) as { verdicts?: { i?: number; verdict?: string; why?: string }[] };
    const verdicts = new Map<number, { verdict: string; why: string }>();
    for (const v of raw.verdicts ?? []) {
      if (typeof v.i === "number") verdicts.set(v.i, { verdict: String(v.verdict ?? "").toLowerCase(), why: String(v.why ?? "") });
    }
    const kept: StruggleEvidence[] = [];
    const dropped: VerifyResult["dropped"] = [];
    evidence.forEach((e, i) => {
      const v = verdicts.get(i);
      if (v && v.verdict === "drop") dropped.push({ tag: e.tag, quote: e.quote, why: `judge: ${v.why}` });
      else kept.push(e);
    });
    return { kept, dropped, judged: true };
  } catch {
    return { kept: evidence, dropped: [], judged: false };
  }
}
