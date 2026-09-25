import Link from "next/link";
import { prisma } from "@/lib/db";
import type { AnalysisResult } from "@/lib/ai/types";

export const dynamic = "force-dynamic";

type Status = "needs_approval" | "ready_to_post" | "waiting" | "replied" | "blocked" | "held" | "no_reply" | "new";

const STATUS: Record<Status, { label: string; cls: string; hint: string }> = {
  needs_approval: { label: "Needs approval", cls: "bg-amber-100 text-amber-800", hint: "A reply is drafted — approve, edit or reject it." },
  ready_to_post: { label: "Ready to post", cls: "bg-emerald-100 text-emerald-700", hint: "Approved — copy and paste it on Reddit." },
  waiting: { label: "Waiting for reply", cls: "bg-sky-100 text-sky-700", hint: "You posted — the agent checks the thread every 30 min." },
  replied: { label: "They replied", cls: "bg-violet-100 text-violet-700", hint: "New reply from the person — draft a follow-up." },
  blocked: { label: "Do not contact", cls: "bg-red-100 text-red-700", hint: "Never engaged (e.g. self-reported minor). Still counts as signal in Insights." },
  held: { label: "Held by gates", cls: "bg-orange-100 text-orange-700", hint: "A help-first / no-claims gate removed the draft — open to regenerate." },
  no_reply: { label: "Listen only", cls: "bg-zinc-100 text-zinc-500", hint: "Counted in Insights, no reply recommended (e.g. community doesn't allow it)." },
  new: { label: "No draft yet", cls: "bg-zinc-100 text-zinc-600", hint: "Analyzed, no reply drafted yet — press \"Draft replies\" on Home." },
};
const ORDER: Status[] = ["needs_approval", "ready_to_post", "replied", "waiting", "new", "held", "no_reply", "blocked"];

const catClass: Record<string, string> = {
  HOT: "text-red-700",
  WARM: "text-amber-700",
  COLD: "text-sky-700",
  IGNORE: "text-zinc-400",
};

function ago(d: Date) {
  const h = Math.round((Date.now() - d.getTime()) / 36e5);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

export default async function PeoplePage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const showMock = searchParams.mock === "1";
  const filter = (searchParams.status ?? "all") as Status | "all";
  const sub = searchParams.subreddit;
  const q = searchParams.q?.trim() ?? "";

  const conversations = await prisma.conversation.findMany({
    where: {
      ...(showMock ? {} : { lead: { isMock: false } }),
      ...(sub ? { subreddit: sub } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { lead: { redditUsername: { contains: q, mode: "insensitive" } } },
              { lead: { problem: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: {
      lead: true,
      actions: { orderBy: { createdAt: "desc" }, take: 1, where: { status: { notIn: ["SUPERSEDED", "REJECTED", "SNOOZED"] } } },
    },
    take: 300,
  });

  const rows = conversations.map((c) => {
    const a = c.actions[0];
    const analysis = c.lastAnalysis as unknown as AnalysisResult | null;
    const gates = analysis?.blocked ?? [];
    let status: Status = "new";
    if (c.lead.doNotContact || gates.some((g) => /minor/i.test(g))) status = "blocked";
    else if (a && ["PROPOSED", "APPROVAL_REQUESTED"].includes(a.status)) status = "needs_approval";
    else if (a && ["APPROVED", "MANUAL_REQUIRED", "EXECUTING"].includes(a.status)) status = "ready_to_post";
    else if (c.stage === "ACTIVE_CONVERSATION") status = "replied";
    else if (a?.status === "POSTED" || ["WAITING_FOR_RESPONSE", "HELPING", "ENGAGED", "FOLER_INTRODUCED", "WAITLIST_INVITED"].includes(c.stage)) status = "waiting";
    else if (analysis?.recommended_action === "IGNORE") status = "no_reply";
    else if (gates.length > 0) status = "held";
    return { c, status };
  });

  const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const visible = rows
    .filter((r) => filter === "all" || r.status === filter)
    .sort((x, y) => ORDER.indexOf(x.status) - ORDER.indexOf(y.status) || y.c.lead.leadScore - x.c.lead.leadScore || y.c.lastActivityAt.getTime() - x.c.lastActivityAt.getTime());
  const subreddits = Array.from(new Set(conversations.map((c) => c.subreddit))).sort();

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { status: filter === "all" ? undefined : filter, subreddit: sub, q: q || undefined, mock: showMock ? "1" : undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/people${s ? `?${s}` : ""}`;
  };
  const pill = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-[12px] ${active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"}`;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">People</h1>
          <p className="text-[13px] text-zinc-500">Everyone the agent found, one row per conversation. Ranked by how well we can help; click a row to see the thread and the drafted reply.</p>
        </div>
        <form className="flex w-full items-center gap-2 sm:w-auto" role="search">
          {filter !== "all" && <input type="hidden" name="status" value={filter} />}
          {sub && <input type="hidden" name="subreddit" value={sub} />}
          {showMock && <input type="hidden" name="mock" value="1" />}
          <input name="q" defaultValue={q} placeholder="Search name, post or problem…" type="search" className="w-full rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[12px] sm:w-60" />
          <Link href={qs({ mock: showMock ? undefined : "1" })} className={pill(showMock)}>{showMock ? "Hide demo data" : "Show demo data"}</Link>
        </form>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Link href={qs({ status: undefined })} className={pill(filter === "all")}>All · {rows.length}</Link>
        {ORDER.filter((s) => counts[s]).map((s) => (
          <Link key={s} href={qs({ status: s })} className={pill(filter === s)} title={STATUS[s].hint}>
            {STATUS[s].label} · {counts[s]}
          </Link>
        ))}
        {subreddits.length > 1 && (
          <>
            <span className="mx-1 text-zinc-300">|</span>
            {subreddits.map((s) => (
              <Link key={s} href={qs({ subreddit: sub === s ? undefined : s })} className={pill(sub === s)}>r/{s}</Link>
            ))}
          </>
        )}
      </div>

      {filter !== "all" && <p className="text-[12px] text-zinc-500">{STATUS[filter].hint}</p>}

      <div className="card overflow-hidden">
        <table className="w-full table-fixed border-collapse text-[13px] sm:table-auto">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-400">
              <th className="px-3 py-2 font-medium">Person &amp; what they struggle with</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">Community</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Score</th>
              <th className="w-28 px-3 py-2 font-medium sm:w-auto">Status</th>
              <th className="hidden px-3 py-2 text-right font-medium md:table-cell">Activity</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ c, status }) => (
              <tr key={c.id} className="group border-b border-zinc-100 transition-colors hover:bg-zinc-50">
                <td className="max-w-[520px] px-3 py-2.5">
                  <Link href={`/conversations/${c.id}`} className="block min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 font-medium text-zinc-900 group-hover:underline">u/{c.lead.redditUsername}</span>
                      {c.lead.isMock && <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800">DEMO</span>}
                      <span className="truncate text-zinc-400">· {c.title}</span>
                    </div>
                    <div className="truncate text-[12px] text-zinc-500">{c.lead.problem || "Not analyzed yet"}</div>
                    <div className="mt-0.5 flex gap-2 text-[11px] text-zinc-400 lg:hidden">
                      <span>r/{c.subreddit}</span>
                      <span className={`sm:hidden ${catClass[c.lead.category] ?? ""}`}>score {c.lead.leadScore}</span>
                      <span className="md:hidden">{ago(c.lastActivityAt)}</span>
                    </div>
                  </Link>
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 text-zinc-600 lg:table-cell">r/{c.subreddit}</td>
                <td className={`hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums font-medium sm:table-cell ${catClass[c.lead.category] ?? ""}`}>{c.lead.leadScore}</td>
                <td className="px-3 py-2.5">
                  <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[status].cls}`} title={STATUS[status].hint}>{STATUS[status].label}</span>
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 text-right text-[12px] text-zinc-400 md:table-cell">{ago(c.lastActivityAt)}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-zinc-400">{q ? `Nobody matches “${q}”.` : "Nobody here yet."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
