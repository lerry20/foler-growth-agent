"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2 } from "lucide-react";
import { toast, isFailureText } from "./toast";
import { BTN } from "./btn";

export { BTN };

export function describe(r: unknown): string {
  if (r === undefined || r === null) return "Done";
  if (typeof r === "string") return r;
  if (typeof r === "number") return String(r);
  if (typeof r === "object" && "message" in r && typeof (r as { message: unknown }).message === "string") {
    return (r as { message: string }).message;
  }
  return "Done";
}

const isFailure = isFailureText;

export function Status({ text, className = "" }: { text: string; className?: string }) {
  if (!text) return null;
  const bad = isFailure(text);
  return (
    <span
      role="status"
      className={`flash inline-flex max-w-md items-start gap-1 text-[11px] leading-snug ${bad ? "text-red-700" : "text-sage-700"} ${className}`}
    >
      {!bad && <Check size={12} className="mt-[1px] shrink-0" />}
      {text}
    </span>
  );
}

export function ActionButton(props: {
  label: string;
  action: () => Promise<unknown>;
  className?: string;
  confirm?: string;
  title?: string;
  /** How long the result message stays visible (ms). 0 = until the next click. */
  clearAfter?: number;
  /** Also show the result as a toast — use when the button's container may disappear after the action. */
  toast?: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const show = (text: string) => {
    if (props.toast) toast(text);
    setResult(text);
    if (timer.current) clearTimeout(timer.current);
    const ms = props.clearAfter ?? 6000;
    if (ms > 0 && !isFailure(text)) timer.current = setTimeout(() => setResult(""), ms);
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        title={props.title}
        onClick={() => {
          if (props.confirm && !window.confirm(props.confirm)) return;
          setResult("");
          start(async () => {
            try {
              const r = await props.action();
              show(describe(r));
            } catch (e) {
              show(`Error: ${e instanceof Error ? e.message : String(e)}`);
            }
          });
        }}
        className={props.className ?? BTN.primary}
      >
        {pending && <Loader2 size={13} className="spin shrink-0" />}
        {props.label}
      </button>
      <Status text={result} />
    </span>
  );
}

/**
 * Form whose server action result is shown as a toast. Works with <SubmitButton> inside it
 * (useFormStatus drives the spinner). Survives the page re-render that revalidatePath triggers.
 */
export function ActionForm({
  action,
  ok,
  className,
  children,
}: {
  action: (fd: FormData) => Promise<unknown>;
  /** Message on success; defaults to the server's `message` or "Saved". */
  ok?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <form
      className={className}
      action={async (fd: FormData) => {
        try {
          const r = await action(fd);
          const text = ok ?? (r === undefined || r === null ? "Saved" : describe(r));
          toast(text);
        } catch (e) {
          toast(`Error: ${e instanceof Error ? e.message : String(e)}`);
        }
      }}
    >
      {children}
    </form>
  );
}

/** Submit button for forms: disabled with a spinner while the form action runs. */
export function SubmitButton({
  children = "Save",
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={className ?? BTN.primary}>
      {pending && <Loader2 size={13} className="spin shrink-0" />}
      {children}
    </button>
  );
}

export function CopyButton({ text, className, label = "Copy" }: { text: string; className?: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      title="Copy the comment to your clipboard"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 1500);
      }}
      className={className ?? BTN.ghost}
    >
      {state === "copied" ? (
        <>
          <Check size={13} /> Copied
        </>
      ) : state === "failed" ? (
        "Select & copy by hand"
      ) : (
        label
      )}
    </button>
  );
}
