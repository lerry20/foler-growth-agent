"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { approveActionForm } from "@/app/actions";
import { Status } from "@/components/buttons";
import { BTN } from "@/components/btn";
import { toast } from "@/components/toast";

export function EditApprove({ actionId, initial }: { actionId: string; initial: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initial);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={BTN.ghost} title="Change the wording before approving">
        Edit
      </button>
    );
  return (
    <div className="w-full space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        autoFocus
        className="w-full rounded-md border border-zinc-300 p-2.5 text-[12px] leading-relaxed break-words [overflow-wrap:anywhere]"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending || !text.trim()}
          className={BTN.primary}
          title="Approve your edited version — you still post it yourself"
          onClick={() =>
            start(async () => {
              try {
                const r = await approveActionForm(actionId, text);
                setMsg(r.message);
                toast(r.message);
              } catch (e) {
                setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
              }
            })
          }
        >
          {pending && <Loader2 size={13} className="spin" />}
          Approve with edits
        </button>
        <button type="button" disabled={pending} onClick={() => { setOpen(false); setText(initial); }} className={BTN.ghost}>
          Cancel
        </button>
        <Status text={msg} />
      </div>
    </div>
  );
}
