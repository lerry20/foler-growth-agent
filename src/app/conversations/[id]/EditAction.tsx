"use client";

import { useState } from "react";
import { approveActionForm } from "@/app/actions";

export function EditApprove({ actionId, initial }: { actionId: string; initial: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initial);
  const [msg, setMsg] = useState("");
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="rounded border border-zinc-300 px-2 py-1 text-[11px] hover:bg-zinc-100">
        Edit
      </button>
    );
  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="w-full rounded border border-zinc-300 p-2 text-[12px] break-words [overflow-wrap:anywhere]"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={async () => {
            const r = await approveActionForm(actionId, text);
            setMsg(r.message);
          }}
          className="rounded bg-zinc-900 px-2 py-1 text-[11px] text-white"
        >
          Approve with edits
        </button>
        <button onClick={() => setOpen(false)} className="text-[11px] text-zinc-500">
          Cancel
        </button>
        {msg && <span className="text-[11px] text-zinc-500">{msg}</span>}
      </div>
    </div>
  );
}
