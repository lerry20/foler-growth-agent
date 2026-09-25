"use client";

import { useState, useTransition } from "react";

function describe(r: unknown): string {
  if (r === undefined || r === null) return "Done";
  if (typeof r === "string") return r;
  if (typeof r === "number") return String(r);
  if (typeof r === "object" && "message" in r && typeof (r as { message: unknown }).message === "string") {
    return (r as { message: string }).message;
  }
  return "Done";
}

export function ActionButton(props: {
  label: string;
  action: () => Promise<unknown>;
  className?: string;
  confirm?: string;
  title?: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState("");
  return (
    <span className="inline-flex items-center gap-2">
      <button
        disabled={pending}
        title={props.title}
        onClick={() =>
          start(async () => {
            if (props.confirm && !window.confirm(props.confirm)) return;
            try {
              const r = await props.action();
              setResult(describe(r));
            } catch (e) {
              setResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
            }
          })
        }
        className={
          props.className ??
          "rounded-md bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        }
      >
        {pending ? "Working…" : props.label}
      </button>
      {result && <span className="max-w-md text-[11px] leading-snug text-zinc-500">{result}</span>}
    </span>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded border border-zinc-300 px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
