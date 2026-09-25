import Link from "next/link";
import { prisma } from "@/lib/db";
import { ourUsername } from "@/lib/ingest";
import { ActionButton } from "@/components/buttons";
import { runCopilotAction, refreshAllAction } from "@/app/actions";
import { OutreachCard, type Column, type OutreachItem } from "./OutreachCard";

export const dynamic = "force-dynamic";

const PENDING = ["PROPOSED", "APPROVAL_REQUESTED"];
const READY = ["APPROVED", "EXECUTING", "MANUAL_REQUIRED"];

const COLUMNS: { key: Column; title: string; hint: string }[] = [
  { key: "approve", title: "Needs your approval", hint: "AI-drafted helpful replies. Approve, edit or reject." },
  { key: "post", title: "Ready to post", hint: "Copy → open thread → paste from your account → I posted it." },
  { key: "waiting", title: "Posted · waiting for reply", hint: "Checked every 30 min. Replies trigger re-analysis." },
  { key: "reply", title: "They replied · follow up", hint: "Permission-gated: FOLĒR only after they ask." },
];

export default async function OutreachPage() {
  const our = (await ourUsername()).toLowerCase();
  const [conversations, health, postedToday, signups] = await Promise.all([
    prisma.conversation.findMany({
      where: {
        lead: { doNotContact: false },
        OR: [{ actions: { some: {} } }, { messages: { some: { direction: "OUTBOUND" } } }],
      },
      include: {
        lead: true,
        actions: { orderBy: { createdAt: "desc" }, take: 3 },
        messages: { orderBy: { postedAt: "desc" }, where: { isOriginalPost: false }, take: 5 },
      },
      orderBy: { lastActivityAt: "desc" },
      take: 150,
    }),
    prisma.accountHealth.findUnique({ where: { id: "default" } }),
    prisma.event.count({ where: { type: "COMMENT_POSTED", createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    prisma.event.count({ where: { type: "WAITLIST_SIGNUP" } }),
  ]);

  const cols: Record<Column, OutreachItem[]> = { approve: [], post: [], waiting: [], reply: [] };
  let blocked = 0;

  for (const c of conversations) {
    const latest = c.actions[0];
    const pending = c.actions.find((a) => PENDING.includes(a.status));
    const ready = c.actions.find((a) => READY.includes(a.status));
    const posted = c.actions.find((a) => a.status === "POSTED");
    const lastOut = c.messages.find((m) => m.direction === "OUTBOUND");
    const lastIn = c.messages.find((m) => m.direction === "INBOUND" && m.author.toLowerCase() !== our);
    const replied = lastIn && lastOut && lastIn.postedAt > lastOut.postedAt;

    const base = {
      conversationId: c.id,
      username: c.lead.redditUsername,
      subreddit: c.subreddit,
      title: c.title,
      problem: c.lead.problem ?? "",
      leadScore: c.lead.leadScore,
      category: c.lead.category,
      redditUrl: c.redditUrl,
      stage: c.stage,
      permission: c.permissionState,
      postedAt: lastOut?.postedAt.toISOString() ?? posted?.executedAt?.toISOString() ?? null,
      lastInboundAt: lastIn?.postedAt.toISOString() ?? null,
      lastInboundAuthor: lastIn?.author ?? null,
      lastInboundText: lastIn?.content ?? null,
      isMock: c.lead.isMock,
    };

    if (pending) {
      if (pending.errorMessage?.startsWith("Preflight:")) { blocked++; continue; }
      cols.approve.push({ ...base, actionId: pending.id, actionType: pending.type, actionStatus: pending.status, text: pending.proposedResponse });
    } else if (ready) {
      cols.post.push({ ...base, actionId: ready.id, actionType: ready.type, actionStatus: ready.status, text: ready.finalResponse ?? ready.proposedResponse });
    } else if (replied) {
      cols.reply.push({ ...base, actionId: latest?.id ?? null, actionType: latest?.type ?? null, actionStatus: latest?.status ?? null, text: lastOut.content });
    } else if (lastOut || posted) {
      cols.waiting.push({ ...base, actionId: posted?.id ?? null, actionType: posted?.type ?? null, actionStatus: posted?.status ?? null, text: lastOut?.content ?? posted?.finalResponse ?? posted?.proposedResponse ?? "" });
    }
  }
  cols.approve.sort((a, b) => b.leadScore - a.leadScore);
  cols.post.sort((a, b) => b.leadScore - a.leadScore);

  const stats = [
    { label: "Posted last 24h", value: postedToday },
    { label: "Waitlist signups", value: signups },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Outreach</h1>
          <p className="text-[13px] text-zinc-500">Left to right: approve → post → wait → follow up. Nothing is posted without you.</p>
        </div>
        <div className="flex items-center gap-2">
          <ActionButton label="Draft replies" action={runCopilotAction} />
          <ActionButton label="Check for replies" action={refreshAllAction} className="rounded-md border border-zinc-300 px-3 py-1.5 text-[12px] text-zinc-700 hover:bg-zinc-100" />
        </div>
      </div>

      {(health?.outboundPaused || blocked > 0 || stats.some((s) => s.value > 0)) && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {stats.filter((s) => s.value > 0).map((s) => (
            <span key={s.label} className="rounded bg-white px-2 py-1 text-zinc-600 ring-1 ring-zinc-200"><b className="tabular-nums">{s.value}</b> {s.label.toLowerCase()}</span>
          ))}
          {health?.outboundPaused && <span className="rounded bg-red-100 px-2 py-1 text-red-700">Outbound paused{health.pausedReason ? `: ${health.pausedReason}` : ""}</span>}
          {blocked > 0 && <span className="rounded bg-zinc-100 px-2 py-1 text-zinc-600">{blocked} draft{blocked > 1 ? "s" : ""} held back by help-first gates (see <Link href="/people?status=held" className="underline">People</Link>)</span>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-4">
        {COLUMNS.map((col) => (
          <section key={col.key} className="min-w-0 rounded-xl border border-zinc-200 bg-zinc-100/60 p-2">
            <div className="flex items-baseline justify-between px-1 pb-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{col.title}</h2>
              <span className="rounded-full bg-white px-2 text-[11px] font-medium tabular-nums text-zinc-600">{cols[col.key].length}</span>
            </div>
            <div className="px-1 pb-2 text-[11px] text-zinc-400">{col.hint}</div>
            <div className="space-y-2">
              {cols[col.key].map((item) => <OutreachCard key={item.conversationId} item={item} column={col.key} />)}
              {cols[col.key].length === 0 && <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-[11px] text-zinc-400">Nothing here</div>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
