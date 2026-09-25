"use client";

import { useSyncExternalStore } from "react";
import { Check, X } from "lucide-react";

type Toast = { id: number; text: string; bad: boolean };

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
let seq = 0;

function emit() {
  for (const l of listeners) l();
}

export function isFailureText(text: string) {
  return /^error|failed|refuses|blocked|could not|couldn't|no reply drafted|not found|expired/i.test(text);
}

export function toast(text: string, opts: { bad?: boolean; ms?: number } = {}) {
  const bad = opts.bad ?? isFailureText(text);
  const t: Toast = { id: ++seq, text, bad };
  toasts = [...toasts.slice(-3), t];
  emit();
  setTimeout(() => dismiss(t.id), opts.ms ?? (bad ? 7000 : 3500));
}

function dismiss(id: number) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const getSnapshot = () => toasts;
const empty: Toast[] = [];
const getServerSnapshot = () => empty;

export function Toaster() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (list.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-3 md:inset-x-auto md:bottom-5 md:right-5 md:items-end">
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`flash pointer-events-auto flex max-w-md items-start gap-2 rounded-lg px-3.5 py-2.5 text-[12px] leading-snug shadow-lg ring-1 ${
            t.bad ? "bg-red-50 text-red-800 ring-red-200" : "bg-zinc-900 text-white ring-zinc-900/10"
          }`}
        >
          {!t.bad && <Check size={14} className="mt-[1px] shrink-0 text-sage-400" />}
          <span className="flex-1">{t.text}</span>
          <button type="button" onClick={() => dismiss(t.id)} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
