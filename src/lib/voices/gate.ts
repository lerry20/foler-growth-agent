import { env } from "@/lib/env";
import { analyzeWithAnthropic } from "@/lib/ai/anthropic";
import type { SpeaksAbout } from "@prisma/client";
import type { VoiceDraft } from "./split";

export interface GateResult {
  speaksAbout: SpeaksAbout;
  inScope: boolean | null;
  minor: boolean | null;
  why: string;
  /** "anthropic" when the model decided, "prefilter" for deterministic exclusions, "none" when no judgement could be made. */
  provider: "anthropic" | "prefilter" | "none";
}

export interface GateContext {
  title: string;
  /** The original post text, shown to the model as context when gating a commenter. */
  opText: string;
  subreddit: string;
}

const SPEAKS: readonly SpeaksAbout[] = ["OWN_CASE", "SOMEONE_ELSE", "ADVICE_ONLY", "VENDOR", "META", "UNCLEAR"];

export const GATE_VERSION = "gate-v1";

const SYSTEM = `You read online health conversations the way a careful clinician-researcher would: literally, in context, without guessing. You judge ONE participant at a time and answer only with JSON.`;

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function gatePrompt(voice: VoiceDraft, ctx: GateContext): string {
  const who = voice.role === "OP" ? "the ORIGINAL POSTER" : "a COMMENTER replying in the thread";
  const context =
    voice.role === "OP"
      ? ""
      : `\nORIGINAL POST (context only — do NOT classify its author):\n"""\n${clip(ctx.opText, 1500)}\n"""\n`;
  return `Community: r/${ctx.subreddit}
Thread title: ${ctx.title}
${context}
PARTICIPANT to judge: u/${voice.author}, ${who}. Everything they wrote in this thread:
"""
${clip(voice.text, 4000)}
"""

Question: what is this participant talking about?

speaks_about must be exactly one of:
- "own_case"      — they describe THEIR OWN hair/scalp/health situation, treatment, symptoms, worries or decisions (even briefly, e.g. "same here, 8 months on fin and nothing"). Sharing their own experience while also advising counts as own_case.
- "advice_only"   — they only advise, inform, ask questions of, or react to someone else; nothing about their own case.
- "someone_else"  — they describe a specific other person's case (partner, child, parent, friend) and not their own.
- "vendor"        — selling, promoting, affiliate/clinic marketing.
- "meta"          — moderation, subreddit rules, jokes, off-topic, spam.
- "unclear"       — you genuinely cannot tell from their words. Prefer this over guessing.

in_scope: true if own_case is about hair loss, hair thinning, scalp, or its treatment; false otherwise; null if speaks_about is not own_case.
minor: true only if they state or clearly imply they are under 18; false if clearly adult; null if unknown.
why: ONE sentence citing the words that decided it.

Return JSON only:
{"speaks_about":"…","in_scope":true|false|null,"minor":true|false|null,"why":"…"}`;
}

function parse(raw: unknown): GateResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { speaks_about?: unknown; in_scope?: unknown; minor?: unknown; why?: unknown };
  const sa = String(r.speaks_about ?? "").toUpperCase();
  if (!SPEAKS.includes(sa as SpeaksAbout)) return null;
  const speaksAbout = sa as SpeaksAbout;
  const inScope = speaksAbout === "OWN_CASE" && typeof r.in_scope === "boolean" ? r.in_scope : speaksAbout === "OWN_CASE" ? null : false;
  return {
    speaksAbout,
    inScope,
    minor: typeof r.minor === "boolean" ? r.minor : null,
    why: typeof r.why === "string" ? r.why.slice(0, 300) : "",
    provider: "anthropic",
  };
}

const PREFILTER_WHY: Record<NonNullable<VoiceDraft["prefilter"]>, string> = {
  deleted: "Deleted or removed content.",
  bot: "Automated account.",
  too_short: "Fewer than 8 words — not enough to judge.",
};

/**
 * Decide whether a voice is a person describing their own case. Never guesses: when the model is
 * unavailable or fails, the voice is UNCLEAR so it lands in the review queue instead of the stats.
 */
export async function gateVoice(voice: VoiceDraft, ctx: GateContext): Promise<GateResult> {
  if (voice.prefilter) {
    return {
      speaksAbout: voice.prefilter === "too_short" ? "UNCLEAR" : "META",
      inScope: false,
      minor: null,
      why: PREFILTER_WHY[voice.prefilter],
      provider: "prefilter",
    };
  }
  if (!env.ANTHROPIC_API_KEY) {
    return { speaksAbout: "UNCLEAR", inScope: null, minor: null, why: "No model available.", provider: "none" };
  }
  try {
    const raw = await analyzeWithAnthropic(SYSTEM, gatePrompt(voice, ctx), { temperature: 0, maxTokens: 300 });
    const parsed = parse(raw);
    if (parsed) return parsed;
    return { speaksAbout: "UNCLEAR", inScope: null, minor: null, why: "Model returned an unreadable answer.", provider: "none" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { speaksAbout: "UNCLEAR", inScope: null, minor: null, why: `Model error: ${msg.slice(0, 200)}`, provider: "none" };
  }
}
