"use client";

import { useTransition } from "react";
import { Loader2, Check, X, Plus } from "lucide-react";
import type { StruggleVerdict } from "@prisma/client";
import { describe } from "@/components/buttons";
import { toast } from "@/components/toast";
import { STRUGGLE_TAGS, STRUGGLE_LABELS, STRUGGLE_RULES, type StruggleTag } from "@/lib/insights/taxonomy";
import { reviewLabelAction, clearLabelReviewAction } from "../actions";

export type LabelRow = { tag: StruggleTag; quote: string; verdict: StruggleVerdict | null };

export function Labels({
  conversationId,
  labels,
  missed,
  provider,
}: {
  conversationId: string;
  labels: LabelRow[];
  missed: StruggleTag[];
  provider: string;
}) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      try {
        toast(describe(await fn()));
      } catch (e) {
        toast(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  const taken = new Set<string>([...labels.map((l) => l.tag), ...missed]);
  const addable = STRUGGLE_TAGS.filter((t) => t !== "OTHER" && !taken.has(t));
  const engineName = provider === "anthropic" ? "Claude" : provider === "heuristic" ? "keyword rules (model was unavailable)" : "engine";

  return (
    <div className="space-y-2" aria-busy={pending}>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-zinc-400">
        <span>Engine says they struggle with</span>
        {labels.length > 0 && <span className="normal-case tracking-normal">labelled by {engineName}</span>}
      </div>

      {labels.length === 0 && missed.length === 0 && (
        <p className="text-[12px] text-zinc-500">No struggle found by the engine. If you see one in their words, add it below.</p>
      )}

      {labels.map((l) => {
        const on = (v: StruggleVerdict) => l.verdict === v;
        return (
          <div key={l.tag} className={`rounded-md border p-2 ${l.verdict === "WRONG" ? "border-red-200 bg-red-50/40" : l.verdict === "RIGHT" ? "border-emerald-200 bg-emerald-50/40" : "border-zinc-200 bg-white"}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-white" title={STRUGGLE_RULES[l.tag]}>
                {STRUGGLE_LABELS[l.tag]}
              </span>
              {l.verdict === "WRONG" && <span className="text-[11px] text-red-700">removed from Insights</span>}
              {l.verdict === "RIGHT" && <span className="text-[11px] text-emerald-700">confirmed</span>}
            </div>
            <p className="mt-1 text-[12px] leading-snug text-zinc-700">
              <span className="text-zinc-400">because they wrote: </span>
              {l.quote ? <q className="italic">{l.quote}</q> : <span className="text-red-600">no quote recorded — an older run before proof was required</span>}
            </p>
            <details className="mt-1 text-[11px] text-zinc-500">
              <summary className="cursor-pointer select-none hover:text-zinc-700">When this label is allowed</summary>
              <p className="mt-1 leading-snug">{STRUGGLE_RULES[l.tag]}</p>
            </details>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => reviewLabelAction(conversationId, l.tag, "RIGHT"))}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-60 ${on("RIGHT") ? "border-emerald-700 bg-emerald-700 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:bg-emerald-50"}`}
                title="Yes — this person is really struggling with this, and the quote proves it."
              >
                <Check size={12} /> Right
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => reviewLabelAction(conversationId, l.tag, "WRONG"))}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-60 ${on("WRONG") ? "border-red-700 bg-red-700 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:bg-red-50"}`}
                title="No — they are not struggling with this (e.g. they deny it, it's someone else's problem, or the quote doesn't show it). Removes it from Insights."
              >
                <X size={12} /> Wrong
              </button>
              {l.verdict && !pending && (
                <button type="button" onClick={() => run(() => clearLabelReviewAction(conversationId, l.tag))} className="ml-1 text-[11px] text-zinc-400 underline-offset-2 hover:underline">
                  undo
                </button>
              )}
            </div>
          </div>
        );
      })}

      {missed.map((t) => (
        <div key={t} className="rounded-md border border-sky-200 bg-sky-50/40 p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-sky-700 px-2 py-0.5 text-[11px] font-medium text-white" title={STRUGGLE_RULES[t]}>{STRUGGLE_LABELS[t]}</span>
            <span className="text-[11px] text-sky-800">added by you — the engine missed it</span>
            {!pending && (
              <button type="button" onClick={() => run(() => clearLabelReviewAction(conversationId, t))} className="ml-auto text-[11px] text-zinc-400 underline-offset-2 hover:underline">
                undo
              </button>
            )}
          </div>
        </div>
      ))}

      {addable.length > 0 && (
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <Plus size={12} className="text-zinc-400" />
          <span>Engine missed a struggle?</span>
          <select
            disabled={pending}
            value=""
            onChange={(e) => {
              const t = e.target.value as StruggleTag;
              if (t) run(() => reviewLabelAction(conversationId, t, "MISSED"));
            }}
            className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 disabled:opacity-60"
          >
            <option value="">add one…</option>
            {addable.map((t) => (
              <option key={t} value={t}>{STRUGGLE_LABELS[t]}</option>
            ))}
          </select>
          {pending && <Loader2 size={12} className="spin text-zinc-400" />}
        </label>
      )}
    </div>
  );
}
