"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import {
  approveActionForm,
  rejectActionForm,
  snoozeActionForm,
  markPostedForm,
  refreshConversationForm,
  generateActionForm,
} from "@/app/actions";

export type OutreachItem = {
  conversationId: string;
  actionId: string | null;
  actionType: string | null;
  actionStatus: string | null;
  username: string;
  subreddit: string;
  title: string;
  problem: string;
  leadScore: number;
  category: string;
  redditUrl: string;
  text: string;
  stage: string;
  permission: string;
  postedAt: string | null;
  lastInboundAt: string | null;
  lastInboundAuthor: string | null;
  lastInboundText: string | null;
  isMock: boolean;
};

export type Column = "approve" | "post" | "waiting" | "reply";

const catClass: Record<string, string> = {
  HOT: "bg-red-100 text-red-700",
  WARM: "bg-amber-100 text-amber-800",
  COLD: "bg-sky-100 text-sky-700",
  IGNORE: "bg-zinc-100 text-zinc-500",
};

function ago(iso: string | null): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function OutreachCard({ item, column }: { item: OutreachItem; column: Column }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [copied, setCopied] = useState(false);

  const run = (fn: () => Promise<unknown>, okMsg: string) =>
    start(async () => {
      try {
        const r = await fn();
        const failed = r && typeof r === "object" && "ok" in r && (r as { ok: boolean }).ok === false;
        setMsg(failed ? ((r as { reason?: string }).reason ?? "Failed") : okMsg);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e));
      }
    });

  const btn = "rounded-md bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-zinc-700 disabled:opacity-50";
  const ghost = "rounded-md border border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-50";

  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Link href={`/conversations/${item.conversationId}`} className="truncate font-medium text-zinc-800 hover:underline">
              u/{item.username}
            </Link>
            <span className="text-zinc-400">·</span>
            <span className="truncate text-zinc-500">r/{item.subreddit}</span>
            {item.isMock && <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800">MOCK</span>}
          </div>
          <a href={item.redditUrl} target="_blank" rel="noreferrer" className="mt-0.5 line-clamp-1 text-[12px] text-zinc-600 hover:underline">
            {item.title}
          </a>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${catClass[item.category] ?? ""}`}>{item.category}</span>
          <span className="tabular-nums text-[11px] font-semibold text-zinc-700">{item.leadScore}</span>
        </div>
      </div>

      {item.problem && <div className="line-clamp-2 text-[11px] text-zinc-500">{item.problem}</div>}

      {column === "approve" && (
        <>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-400">
            <span>Draft · {item.actionType}</span>
            {item.stage === "ACTIVE_CONVERSATION" && <span className="rounded bg-emerald-100 px-1 text-emerald-700 normal-case">follow-up</span>}
          </div>
          {editing ? (
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} className="w-full rounded border border-zinc-300 p-2 text-[12px]" />
          ) : (
            <div className="rounded border border-zinc-100 bg-zinc-50 p-2 text-[12px] leading-relaxed text-zinc-700 [overflow-wrap:anywhere]">{text}</div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <button disabled={pending || !item.actionId} className={btn} onClick={() => run(() => approveActionForm(item.actionId!, editing && text !== item.text ? text : undefined), "Approved → Ready to post")}>
              {editing ? "Approve edited" : "Approve"}
            </button>
            <button disabled={pending} className={ghost} onClick={() => setEditing((v) => !v)}>{editing ? "Cancel edit" : "Edit"}</button>
            <button disabled={pending || !item.actionId} className={ghost} onClick={() => run(() => rejectActionForm(item.actionId!), "Rejected")}>Reject</button>
            <button disabled={pending || !item.actionId} className={ghost} onClick={() => run(() => snoozeActionForm(item.actionId!), "Snoozed 24h")}>Snooze</button>
          </div>
        </>
      )}

      {column === "post" && (
        <>
          <div className="text-[10px] uppercase tracking-wide text-zinc-400">Approved — paste from your Reddit account</div>
          <div className="rounded border border-emerald-100 bg-emerald-50 p-2 text-[12px] leading-relaxed text-zinc-700 [overflow-wrap:anywhere]">{item.text}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              className={ghost}
              onClick={async () => { await navigator.clipboard.writeText(item.text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            >
              {copied ? "Copied" : "1. Copy"}
            </button>
            <a href={item.redditUrl} target="_blank" rel="noreferrer" className={`${ghost} inline-flex items-center gap-1`}>
              2. Open thread <ExternalLink size={11} />
            </a>
            <button disabled={pending || !item.actionId} className={btn} onClick={() => run(() => markPostedForm(item.actionId!), "Posted → monitoring")}>
              3. I posted it
            </button>
          </div>
        </>
      )}

      {column === "waiting" && (
        <>
          <div className="text-[10px] uppercase tracking-wide text-zinc-400">Your comment · posted {ago(item.postedAt)}</div>
          <div className="line-clamp-3 rounded border border-emerald-100 bg-emerald-50 p-2 text-[12px] text-zinc-700 [overflow-wrap:anywhere]">{item.text}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button disabled={pending} className={ghost} onClick={() => run(() => refreshConversationForm(item.conversationId), "Checked — no new reply yet")}>Check for replies</button>
            <Link href={`/conversations/${item.conversationId}`} className={ghost}>Import reply manually</Link>
          </div>
        </>
      )}

      {column === "reply" && (
        <>
          <div className="text-[10px] uppercase tracking-wide text-zinc-400">
            u/{item.lastInboundAuthor} replied {ago(item.lastInboundAt)} · permission: {item.permission.toLowerCase().replace(/_/g, " ")}
          </div>
          <div className="line-clamp-4 rounded border border-sky-100 bg-sky-50 p-2 text-[12px] text-zinc-700 [overflow-wrap:anywhere]">{item.lastInboundText}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button disabled={pending} className={btn} onClick={() => run(() => generateActionForm(item.conversationId), "Follow-up drafted → Needs approval")}>Draft follow-up</button>
            <Link href={`/conversations/${item.conversationId}`} className={ghost}>Open conversation</Link>
          </div>
        </>
      )}

      {msg && <div className="text-[11px] text-zinc-500">{pending ? "…" : msg}</div>}
    </div>
  );
}
