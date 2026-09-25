import Link from "next/link";
import { prisma } from "@/lib/db";
import { funnelCounts } from "@/lib/funnel";
import { Funnel, Card } from "@/components/Funnel";

export const dynamic = "force-dynamic";

const nice = (s: string) => (s === "(none)" ? "not stated" : s.toLowerCase().replace(/_/g, " "));

function Table({ title, hint, rows }: { title: string; hint?: string; rows: [string, number][] }) {
  return (
    <Card title={title} hint={hint}>
      <table className="w-full text-[12px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-zinc-100 last:border-0">
              <td className="py-1 capitalize">{nice(k)}</td>
              <td className="py-1 text-right tabular-nums font-medium">{v}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="py-1 text-zinc-400">No data.</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

export default async function AnalyticsPage() {
  const [funnel, leads, postedActions, conversations, events] = await Promise.all([
    funnelCounts(),
    prisma.lead.findMany({ select: { subreddit: true, intent: true, treatment: true, category: true } }),
    prisma.action.findMany({ where: { status: "POSTED" }, select: { type: true } }),
    prisma.conversation.findMany({ select: { _count: { select: { messages: true } } } }),
    prisma.event.findMany({ where: { type: { in: ["LEAD_DISCOVERED", "FOLER_INTRODUCED", "WAITLIST_SIGNUP"] } }, select: { type: true, leadId: true, createdAt: true } }),
  ]);

  const count = <K extends string>(key: (l: (typeof leads)[0]) => K | "") =>
    Object.entries(
      leads.reduce<Record<string, number>>((acc, l) => {
        const k = key(l) || "(none)";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
    ).sort((a, b) => b[1] - a[1]);

  const actionCounts = Object.entries(
    postedActions.reduce<Record<string, number>>((acc, a) => {
      acc[a.type] = (acc[a.type] ?? 0) + 1;
      return acc;
    }, {}),
  );

  const avgLen = conversations.length
    ? Math.round((conversations.reduce((s, c) => s + c._count.messages, 0) / conversations.length) * 10) / 10
    : 0;

  const medianMs = (from: string, to: string) => {
    const deltas: number[] = [];
    const byLead = new Map<string, { d?: Date; t?: Date }>();
    for (const e of events) {
      if (!e.leadId) continue;
      const m = byLead.get(e.leadId) ?? {};
      if (e.type === from && !m.d) m.d = e.createdAt;
      if (e.type === to && !m.t) m.t = e.createdAt;
      byLead.set(e.leadId, m);
    }
    for (const m of byLead.values()) if (m.d && m.t) deltas.push(m.t.getTime() - m.d.getTime());
    if (!deltas.length) return null;
    deltas.sort((a, b) => a - b);
    const med = deltas[Math.floor(deltas.length / 2)];
    return `${Math.round(med / 36e5)}h`;
  };

  const insights: string[] = [];
  const total = leads.length;
  for (const [sub, n] of count((l) => l.subreddit)) {
    const relevant = leads.filter((l) => l.subreddit === sub && l.category !== "IGNORE").length;
    if (relevant >= 3) insights.push(`r/${sub}: ${relevant} of its ${n} people are relevant to us (${total} people total).`);
  }
  const hotByIntent = leads.filter((l) => l.category === "HOT");
  if (hotByIntent.length >= 3) {
    const top = count((l) => (hotByIntent.includes(l) ? l.intent : "")).filter(([k]) => k !== "(none)")[0];
    if (top) insights.push(`Strong-fit people most often want: ${nice(top[0])} (${top[1]}).`);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Analytics</h1>
        <p className="text-[13px] text-zinc-500">How the outreach loop performs: from people found to waitlist signups. For what people struggle with, see <Link href="/insights" className="underline underline-offset-2 hover:text-zinc-800">Insights</Link>.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="From found to signed up" hint="Each step counts people who reached at least that stage."><Funnel steps={funnel} /></Card>
        <Card title="Speed" hint="Median time from finding a person to each milestone.">
          <div className="flex justify-between py-1"><span className="text-zinc-500">Messages per conversation (avg)</span><span className="font-medium tabular-nums">{avgLen}</span></div>
          <div className="flex justify-between py-1"><span className="text-zinc-500">Found → FOLĒR mentioned</span><span className="font-medium tabular-nums">{medianMs("LEAD_DISCOVERED", "FOLER_INTRODUCED") ?? "—"}</span></div>
          <div className="flex justify-between py-1"><span className="text-zinc-500">Found → signed up</span><span className="font-medium tabular-nums">{medianMs("LEAD_DISCOVERED", "WAITLIST_SIGNUP") ?? "—"}</span></div>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Table title="Where people come from" rows={count((l) => l.subreddit)} />
        <Table title="What they want" hint="Intent behind the post." rows={count((l) => l.intent)} />
        <Table title="What they use" hint="Treatment mentioned." rows={count((l) => l.treatment)} />
        <Table title="How well we can help" hint="Hot = strong fit, ignore = not for us." rows={count((l) => l.category)} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Table title="Replies you posted, by kind" rows={actionCounts} />
        <Card title="Patterns">
          {insights.length ? (
            <ul className="list-disc space-y-1 pl-4">{insights.map((i, n) => <li key={n}>{i}</li>)}</ul>
          ) : (
            <div className="text-zinc-400">Not enough data yet.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
