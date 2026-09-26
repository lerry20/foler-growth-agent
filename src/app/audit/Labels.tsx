"use client";

import { useState, useTransition } from "react";
import { Loader2, Check, X, Plus, CornerDownRight } from "lucide-react";
import type { Intent, StruggleVerdict } from "@prisma/client";
import { describe } from "@/components/buttons";
import { toast } from "@/components/toast";
import { STRUGGLE_TAGS, STRUGGLE_LABELS, STRUGGLE_RULES, type StruggleTag } from "@/lib/insights/taxonomy";
import { INTENTS, INTENT_LABEL } from "@/lib/insights/intent";
import { reviewLabelAction, clearLabelReviewAction, noteLabelAction, reviewIntentAction, clearIntentReviewAction } from "../actions";

const NO_STRUGGLE = "NONE";

export type LabelRow = { tag: StruggleTag; quote: string; verdict: StruggleVerdict | null; shouldBe: string | null; note: string };

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
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      try {
        toast(describe(await fn()));
      } catch (e) {
        toast(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  const taken = new Set<string>([...labels.map((l) => l.tag), ...missed, ...labels.map((l) => l.shouldBe ?? "")]);
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
        const wrong = l.verdict === "WRONG";
        const fixed = wrong && l.shouldBe !== null;
        const options = STRUGGLE_TAGS.filter((t) => t !== l.tag && t !== "OTHER");
        return (
          <div key={l.tag} className={`rounded-md border p-2 ${wrong ? "border-red-200 bg-red-50/40" : l.verdict === "RIGHT" ? "border-emerald-200 bg-emerald-50/40" : "border-zinc-200 bg-white"}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium text-white ${wrong ? "bg-zinc-400 line-through" : "bg-zinc-900"}`} title={STRUGGLE_RULES[l.tag]}>
                {STRUGGLE_LABELS[l.tag]}
              </span>
              {wrong && !fixed && <span className="text-[11px] text-red-700">removed from Insights</span>}
              {l.verdict === "RIGHT" && <span className="text-[11px] text-emerald-700">confirmed</span>}
              {fixed && l.shouldBe === NO_STRUGGLE && <span className="text-[11px] text-red-700">no struggle here — nothing counted</span>}
              {fixed && l.shouldBe !== NO_STRUGGLE && (
                <>
                  <CornerDownRight size={12} className="text-zinc-400" />
                  <span className="rounded-full bg-sky-700 px-2 py-0.5 text-[11px] font-medium text-white">{STRUGGLE_LABELS[l.shouldBe as StruggleTag]}</span>
                  <span className="text-[11px] text-sky-800">counted instead, same quote</span>
                </>
              )}
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
                title="No — the quote does not show this struggle. You then say what it really shows."
              >
                <X size={12} /> Wrong
              </button>
              {l.verdict && !pending && (
                <button type="button" onClick={() => run(() => clearLabelReviewAction(conversationId, l.tag))} className="ml-1 text-[11px] text-zinc-400 underline-offset-2 hover:underline">
                  undo
                </button>
              )}
              {l.verdict && (
                <button type="button" onClick={() => setNoteFor(noteFor === l.tag ? null : l.tag)} className="ml-auto text-[11px] text-zinc-400 underline-offset-2 hover:underline">
                  {l.note ? "edit note" : "add note"}
                </button>
              )}
            </div>
            {wrong && (
              <label className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-700">
                <span className="font-medium">So what is it actually?</span>
                <select
                  disabled={pending}
                  value={l.shouldBe ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) run(() => reviewLabelAction(conversationId, l.tag, "WRONG", v));
                  }}
                  className={`rounded border bg-white px-1.5 py-0.5 text-[11px] disabled:opacity-60 ${fixed ? "border-zinc-200 text-zinc-700" : "border-red-300 text-red-800"}`}
                >
                  <option value="">choose…</option>
                  <option value={NO_STRUGGLE}>No struggle here at all</option>
                  {options.map((t) => (
                    <option key={t} value={t}>{STRUGGLE_LABELS[t]}</option>
                  ))}
                </select>
              </label>
            )}
            {l.note && noteFor !== l.tag && <p className="mt-1 text-[11px] text-zinc-500">Your note: {l.note}</p>}
            {noteFor === l.tag && (
              <form
                className="mt-1.5 flex gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const note = String(new FormData(e.currentTarget).get("note") ?? "");
                  setNoteFor(null);
                  run(() => noteLabelAction(conversationId, l.tag, note));
                }}
              >
                <input name="note" defaultValue={l.note} placeholder="Why? (goes into the next classifier's examples)" maxLength={500} className="flex-1 rounded border border-zinc-200 px-2 py-1 text-[11px]" />
                <button type="submit" disabled={pending} className="rounded border border-zinc-900 bg-zinc-900 px-2 py-1 text-[11px] text-white disabled:opacity-60">Save</button>
              </form>
            )}
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

export function IntentReview({ conversationId, engine, human }: { conversationId: string; engine: Intent | null; human: Intent | null }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      try {
        toast(describe(await fn()));
      } catch (e) {
        toast(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-zinc-400">intent:</span>
      {human ? (
        <>
          <span className="text-zinc-400 line-through">{engine ? INTENT_LABEL[engine] : "none"}</span>
          <span className="rounded-full bg-sky-700 px-2 py-0.5 text-[11px] font-medium text-white">{INTENT_LABEL[human]}</span>
          <span className="text-sky-800">your correction</span>
          {!pending && (
            <button type="button" onClick={() => run(() => clearIntentReviewAction(conversationId))} className="text-zinc-400 underline-offset-2 hover:underline">
              undo
            </button>
          )}
        </>
      ) : (
        <>
          <span className="text-zinc-700">{engine ? INTENT_LABEL[engine] : "none read"}</span>
          <select
            disabled={pending}
            value=""
            onChange={(e) => {
              const v = e.target.value as Intent;
              if (v) run(() => reviewIntentAction(conversationId, v));
            }}
            className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 disabled:opacity-60"
            title="Disagree? Pick what this person actually wants."
          >
            <option value="">wrong? it&apos;s…</option>
            {INTENTS.filter((i) => i !== engine).map((i) => (
              <option key={i} value={i}>{INTENT_LABEL[i]}</option>
            ))}
          </select>
        </>
      )}
    </span>
  );
}
