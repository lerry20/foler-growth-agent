"use client";

import { useTransition } from "react";
import { Loader2, Check, X } from "lucide-react";
import type { SpeaksAbout } from "@prisma/client";
import { describe } from "@/components/buttons";
import { toast } from "@/components/toast";
import { reviewVoiceAction, clearVoiceReviewAction } from "../actions";
import { SPEAKS_ABOUT_LABELS } from "@/lib/voices/labels";

const ORDER: SpeaksAbout[] = ["OWN_CASE", "ADVICE_ONLY", "SOMEONE_ELSE", "VENDOR", "META", "UNCLEAR"];

export function Verdict({
  voiceId,
  human,
  model,
}: {
  voiceId: string;
  human: { speaksAbout: SpeaksAbout; inScope: boolean } | null;
  model: { speaksAbout: SpeaksAbout; inScope: boolean | null } | null;
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
  const agrees = human && model ? human.speaksAbout === model.speaksAbout : null;

  return (
    <div className="flex flex-wrap items-center gap-1" aria-busy={pending}>
      {ORDER.map((k) => {
        const on = human?.speaksAbout === k && (k !== "OWN_CASE" || human.inScope);
        return (
          <button
            key={k}
            type="button"
            disabled={pending}
            title={SPEAKS_ABOUT_LABELS[k].hint}
            onClick={() => run(() => reviewVoiceAction(voiceId, k, k === "OWN_CASE"))}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-60 ${
              on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {SPEAKS_ABOUT_LABELS[k].label}
          </button>
        );
      })}
      <button
        type="button"
        disabled={pending}
        title="Their own case, but another health topic (not hair or scalp) — not counted."
        onClick={() => run(() => reviewVoiceAction(voiceId, "OWN_CASE", false))}
        className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-60 ${
          human?.speaksAbout === "OWN_CASE" && !human.inScope ? "border-zinc-900 bg-zinc-900 text-white" : "border-dashed border-zinc-300 text-zinc-500 hover:bg-zinc-100"
        }`}
      >
        Own case, not hair
      </button>
      {pending && <Loader2 size={12} className="spin text-zinc-400" />}
      {!pending && human && (
        <span className={`ml-1 inline-flex items-center gap-1 text-[11px] ${agrees === null ? "text-zinc-500" : agrees ? "text-emerald-700" : "text-red-700"}`}>
          {agrees === null ? "Your call (model undecided)" : agrees ? <><Check size={12} /> Model agreed</> : <><X size={12} /> Model was wrong</>}
          <button type="button" onClick={() => run(() => clearVoiceReviewAction(voiceId))} className="text-zinc-400 underline-offset-2 hover:underline" title="Remove your verdict">
            undo
          </button>
        </span>
      )}
    </div>
  );
}
