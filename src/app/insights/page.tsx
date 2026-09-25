import Link from "next/link";
import { computeInsights } from "@/lib/insights/aggregate";
import { getSynthesis } from "@/lib/insights/synthesis";
import { STRUGGLE_LABELS, type StruggleTag } from "@/lib/insights/taxonomy";
import { Card } from "@/components/Funnel";
import { ActionButton } from "@/components/buttons";
import { regenerateSynthesisAction, backfillInsightsAction } from "../actions";

export const dynamic = "force-dynamic";

function renderMarkdown(md: string) {
  const nodes: React.ReactNode[] = [];
  md.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    if (t.startsWith("#")) nodes.push(<h3 key={i} className="mt-3 font-semibold text-zinc-800">{t.replace(/^#+\s*/, "")}</h3>);
    else if (t.startsWith("-") || t.startsWith("*") || /^\d+\./.test(t)) nodes.push(<li key={i} className="ml-4 list-disc">{t.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "")}</li>);
    else nodes.push(<p key={i}>{t}</p>);
  });
  return nodes;
}

export default async function InsightsPage({ searchParams }: { searchParams: { mock?: string; days?: string } }) {
  const includeMock = searchParams.mock === "1";
  const sinceDays = searchParams.days && searchParams.days !== "all" ? Number(searchParams.days) : undefined;
  const [data, synthesis] = await Promise.all([computeInsights({ includeMock, sinceDays }), getSynthesis()]);

  const { totals } = data;
  const maxTheme = Math.max(1, ...data.themes.map((t) => t.count));
  const maxStruggle = Math.max(1, ...data.struggles.map((s) => s.count));
  const matrixMax = Math.max(1, ...data.treatmentByStruggle.flatMap((r) => r.cells.map((c) => c.count)));
  const maxWeekly = Math.max(1, ...data.weekly.map((w) => w.conversations));
  const struggleCols = data.treatmentByStruggle[0]?.cells.map((c) => c.tag) ?? [];

  const qs = (mock: boolean, days?: string) => `/insights?${mock ? "mock=1&" : ""}days=${days ?? "all"}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Hair-loss intelligence</h1>
        <div className="text-[12px] text-zinc-500">
          What {totals.people} people across {totals.communities} communities are trying to solve — {totals.conversations} conversations, {totals.analyzed} analyzed
        </div>
        <div className="mt-1 flex gap-3 text-[12px]">
          <Link className={includeMock ? "font-medium" : "text-zinc-500"} href={qs(false, searchParams.days ?? "all")}>real only</Link>
          <Link className={includeMock ? "font-medium" : "text-zinc-500"} href={qs(true, searchParams.days ?? "all")}>+ mock</Link>
          <span className="text-zinc-300">|</span>
          {["30", "90", "all"].map((d) => (
            <Link key={d} className={searchParams.days === d || (!searchParams.days && d === "all") ? "font-medium" : "text-zinc-500"} href={qs(includeMock, d)}>{d === "all" ? "all time" : `${d}d`}</Link>
          ))}
        </div>
      </div>

      {totals.analyzed === 0 && (
        <Card title="Insights"><div className="text-zinc-400">No analyzed conversations yet — run discovery or backfill insights below.</div></Card>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-4">
          <Card title="Top problems people want to solve">
            <div className="space-y-2">
              {data.themes.map((t) => (
                <details key={t.theme} className="group">
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium text-zinc-800">{t.theme}</span>
                      <span className="text-[12px] tabular-nums text-zinc-500">{t.count} · {t.share}%</span>
                    </div>
                    <div className="mt-0.5 h-1.5 w-full rounded bg-zinc-100">
                      <div className="h-1.5 rounded bg-zinc-700" style={{ width: `${(t.count / maxTheme) * 100}%` }} />
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {t.communities.map((c) => (
                        <span key={c} className="rounded bg-zinc-100 px-1 py-0.5 text-[10px] text-zinc-500">r/{c}</span>
                      ))}
                    </div>
                  </summary>
                  <ul className="mt-1 space-y-0.5 pl-3">
                    {t.examples.map((e, i) => (
                      <li key={i} className="text-[12px]">
                        <a href={e.url} target="_blank" rel="noreferrer" className="text-zinc-600 underline decoration-zinc-300 hover:text-zinc-900">{e.title}</a>
                        <span className="text-zinc-400"> · r/{e.subreddit}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
              {data.themes.length === 0 && <div className="text-zinc-400">No themes yet — conversations need problem_theme data (backfill below).</div>}
            </div>
          </Card>

          <Card title="What they struggle with">
            <div className="space-y-1.5">
              {data.struggles.map((s) => (
                <div key={s.tag} className="flex items-center gap-3">
                  <span className="w-48 truncate text-[12px] text-zinc-600">{s.label}</span>
                  <div className="h-3 rounded-sm bg-zinc-700/80" style={{ width: `${Math.max(2, (s.count / maxStruggle) * 260)}px` }} />
                  <span className="text-[12px] tabular-nums text-zinc-500">{s.count} · {s.share}%</span>
                </div>
              ))}
              {data.struggles.length === 0 && <div className="text-zinc-400">No struggle tags yet.</div>}
            </div>
          </Card>

          <Card title="Treatments × struggles">
            {data.treatmentByStruggle.length ? (
              <table className="w-full text-[11px]">
                <thead>
                  <tr>
                    <th className="py-1 text-left font-medium text-zinc-400">Treatment</th>
                    {struggleCols.map((t) => <th key={t} className="py-1 px-1 text-left font-medium text-zinc-400">{STRUGGLE_LABELS[t as StruggleTag] ?? t}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.treatmentByStruggle.map((row) => (
                    <tr key={row.treatment} className="border-t border-zinc-100">
                      <td className="py-1 pr-2 text-zinc-600">{row.treatment}</td>
                      {row.cells.map((c) => (
                        <td key={c.tag} className="py-1 px-1">
                          <span className="inline-block min-w-6 rounded px-1 text-center tabular-nums" style={{ backgroundColor: `rgba(39,39,42,${0.08 + 0.7 * (c.count / matrixMax)})`, color: c.count / matrixMax > 0.5 ? "#fff" : "#3f3f46" }}>{c.count || ""}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="text-zinc-400">No treatment data yet.</div>}
          </Card>

          <Card title="Unmet needs">
            <ul className="space-y-1.5">
              {data.unmetNeeds.map((u, i) => (
                <li key={i} className="text-[12px] text-zinc-700">
                  {u.text}{" "}
                  <a href={u.url} target="_blank" rel="noreferrer" className="rounded bg-zinc-100 px-1 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-800">r/{u.subreddit}</a>
                </li>
              ))}
              {data.unmetNeeds.length === 0 && <li className="text-zinc-400">None recorded yet.</li>}
            </ul>
          </Card>
        </div>

        <div className="space-y-4 min-w-0">
          {([
            ["Intents", data.intents],
            ["Hair concerns", data.hairConcerns],
            ["Communities", data.communities],
          ] as const).map(([title, rows]) => (
            <Card key={title} title={title}>
              <table className="w-full text-[12px]">
                <tbody>
                  {rows.slice(0, 10).map((r) => (
                    <tr key={r.key} className="border-b border-zinc-100 last:border-0">
                      <td className="py-1">{r.key}</td>
                      <td className="py-1 text-right tabular-nums font-medium">{r.count}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td className="py-1 text-zinc-400">No data.</td></tr>}
                </tbody>
              </table>
            </Card>
          ))}

          <Card title="Weekly signal">
            <div className="flex items-end gap-1.5">
              {data.weekly.map((w) => (
                <div key={w.week} className="flex flex-col items-center gap-1">
                  <div className="w-6 rounded-sm bg-zinc-700/80" style={{ height: `${Math.max(2, (w.conversations / maxWeekly) * 56)}px` }} title={`${w.week}: ${w.conversations} conversations, top: ${w.topStruggle}`} />
                  <span className="text-[9px] text-zinc-400">{w.week.slice(5)}</span>
                </div>
              ))}
              {data.weekly.length === 0 && <div className="text-zinc-400">No data.</div>}
            </div>
          </Card>

          <Card title="Population synthesis">
            {synthesis.markdown ? (
              <div className="space-y-1 text-[12px] text-zinc-700">{renderMarkdown(synthesis.markdown)}</div>
            ) : (
              <div className="text-zinc-400">Not generated yet.</div>
            )}
            <div className="mt-2 text-[11px] text-zinc-400">{synthesis.generatedAt ? `Generated ${synthesis.generatedAt.slice(0, 16).replace("T", " ")}` : ""}</div>
            <div className="mt-2 flex gap-2">
              <ActionButton label="Regenerate synthesis" action={regenerateSynthesisAction} />
              <ActionButton label="Backfill insights" action={backfillInsightsAction} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
