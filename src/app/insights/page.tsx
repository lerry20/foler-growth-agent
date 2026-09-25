import Link from "next/link";
import { computeInsights } from "@/lib/insights/aggregate";
import { getSynthesis } from "@/lib/insights/synthesis";
import { STRUGGLE_LABELS, type StruggleTag } from "@/lib/insights/taxonomy";
import { ActionButton } from "@/components/buttons";
import { regenerateSynthesisAction, backfillInsightsAction } from "../actions";

export const dynamic = "force-dynamic";

const ACCENT = "#4f46e5";

function renderMarkdown(md: string) {
  const nodes: React.ReactNode[] = [];
  const inline = (s: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) => (p.startsWith("**") ? <strong key={i} className="font-semibold text-zinc-900">{p.slice(2, -2)}</strong> : p));
  };
  md.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t || t === "---") return;
    if (t.startsWith("#")) nodes.push(<h3 key={i} className="mt-4 first:mt-0 text-[13px] font-semibold text-zinc-900">{t.replace(/^#+\s*/, "")}</h3>);
    else if (/^[-*]\s/.test(t)) nodes.push(<li key={i} className="ml-4 list-disc text-zinc-600">{inline(t.replace(/^[-*]\s*/, ""))}</li>);
    else if (/^\d+\.\s/.test(t)) nodes.push(<li key={i} className="ml-4 list-decimal text-zinc-700">{inline(t.replace(/^\d+\.\s*/, ""))}</li>);
    else nodes.push(<p key={i} className="text-zinc-600">{inline(t)}</p>);
  });
  return nodes;
}

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

function Panel({ title, sub, children, className = "" }: { title: string; sub?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-zinc-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-zinc-900">{title}</h2>
        {sub && <span className="text-[11px] text-zinc-400">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function Stat({ value, label, hint }: { value: string | number; label: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white px-4 py-3">
      <div className="text-[22px] font-semibold tracking-tight text-zinc-900 tabular-nums">{value}</div>
      <div className="text-[11px] font-medium text-zinc-500">{label}</div>
      {hint && <div className="text-[10px] text-zinc-400">{hint}</div>}
    </div>
  );
}

function Bars({ rows, max, unit }: { rows: { key: string; count: number }[]; max?: number; unit?: (n: number) => string }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5">
          <span className="truncate text-[12px] text-zinc-600">{r.key}</span>
          <span className="text-[11px] tabular-nums text-zinc-500">{unit ? unit(r.count) : r.count}</span>
          <div className="col-span-2 h-1 rounded-full bg-zinc-100">
            <div className="h-1 rounded-full" style={{ width: `${(r.count / m) * 100}%`, background: ACCENT, opacity: 0.85 }} />
          </div>
        </div>
      ))}
      {rows.length === 0 && <div className="text-[12px] text-zinc-400">No data yet.</div>}
    </div>
  );
}

export default async function InsightsPage({ searchParams }: { searchParams: { mock?: string; days?: string } }) {
  const includeMock = searchParams.mock === "1";
  const daysParam = searchParams.days ?? "all";
  const sinceDays = daysParam !== "all" ? Number(daysParam) : undefined;
  const [data, synthesis] = await Promise.all([computeInsights({ includeMock, sinceDays }), getSynthesis()]);
  const { totals, methodology: m } = data;
  const qs = (mock: boolean, days: string) => `/insights?${mock ? "mock=1&" : ""}days=${days}`;
  const matrixMax = Math.max(1, ...data.treatmentByStruggle.flatMap((r) => r.cells.map((c) => c.count)));
  const struggleCols = data.treatmentByStruggle[0]?.cells.map((c) => c.tag) ?? [];
  const recencyMax = Math.max(1, ...m.recency.map((r) => r.count));
  const confidenceStyle = { robust: "bg-emerald-50 text-emerald-700 ring-emerald-200", emerging: "bg-amber-50 text-amber-700 ring-amber-200", "early signal": "bg-zinc-100 text-zinc-600 ring-zinc-200" }[m.confidence];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>Population intelligence · hair loss</div>
          <h1 className="mt-0.5 text-[22px] font-semibold tracking-tight text-zinc-900">What people are actually trying to solve</h1>
          <p className="mt-1 max-w-2xl text-[12px] text-zinc-500">
            Real, public Reddit conversations from {totals.communities} communities, read one by one by an AI analyst and classified into a fixed taxonomy of {m.taxonomySize} struggles. No surveys, no keywords-only counting — every number below traces back to a real post you can open.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-0.5 text-[11px]">
          {["7", "30", "90", "all"].map((d) => (
            <Link key={d} href={qs(includeMock, d)} className={`rounded-md px-2.5 py-1 ${daysParam === d ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-900"}`}>
              {d === "all" ? "All time" : `Last ${d}d`}
            </Link>
          ))}
          <span className="mx-1 h-4 w-px bg-zinc-200" />
          <Link href={qs(!includeMock, daysParam)} className={`rounded-md px-2.5 py-1 ${includeMock ? "bg-amber-100 text-amber-800" : "text-zinc-400 hover:text-zinc-700"}`}>{includeMock ? "Mock data shown" : "Real only"}</Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat value={totals.people} label="People" hint="distinct Reddit authors" />
        <Stat value={totals.conversations} label="Conversations" hint={`${m.posts} posts · ${m.comments} comments read`} />
        <Stat value={totals.communities} label="Communities" hint={m.sources.map((s) => `r/${s.key}`).join(", ")} />
        <Stat value={totals.analyzed} label="AI-analyzed" hint={`${m.tagged} tagged · ${m.avgTagsPerConversation} tags each`} />
        <Stat value={m.medianAgeDays === null ? "—" : `${m.medianAgeDays}d`} label="Median post age" hint={`${fmtDate(m.firstAt)} → ${fmtDate(m.lastAt)}`} />
        <div className="rounded-xl border border-zinc-200/80 bg-white px-4 py-3">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${confidenceStyle}`}>{m.confidence}</span>
          <div className="mt-1 text-[11px] font-medium text-zinc-500">Sample confidence</div>
          <div className="text-[10px] text-zinc-400">{totals.analyzed < 30 ? `${30 - totals.analyzed} more to "emerging"` : totals.analyzed < 100 ? `${100 - totals.analyzed} more to "robust"` : "n ≥ 100"}</div>
        </div>
      </div>

      {totals.analyzed === 0 && (
        <Panel title="No data yet"><div className="text-[12px] text-zinc-400">Run discovery or backfill insights to populate this page.</div></Panel>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <div className="space-y-5 xl:col-span-3">
          <Panel title="Top problems people want to solve" sub={`% of ${totals.analyzed} analyzed conversations · a conversation can carry up to 3`}>
            <ol className="space-y-3">
              {data.problems.map((p, i) => (
                <li key={p.tag}>
                  <details className="group">
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-baseline gap-3">
                        <span className="w-4 text-[11px] tabular-nums text-zinc-400">{i + 1}</span>
                        <span className="flex-1 text-[13px] font-medium text-zinc-900">{p.label}</span>
                        <span className="text-[13px] font-semibold tabular-nums text-zinc-900">{p.share}%</span>
                        <span className="w-8 text-right text-[11px] tabular-nums text-zinc-400">{p.count}</span>
                      </div>
                      <div className="ml-7 mt-1 h-2 rounded-full bg-zinc-100">
                        <div className="h-2 rounded-full transition-all" style={{ width: `${p.share}%`, background: ACCENT, opacity: 1 - i * 0.08 }} />
                      </div>
                      <div className="ml-7 mt-1 flex flex-wrap gap-1 text-[10px] text-zinc-400">
                        {p.themes.slice(0, 3).map((t) => <span key={t.theme} className="rounded bg-zinc-50 px-1.5 py-0.5 ring-1 ring-zinc-100">{t.theme}</span>)}
                        {p.themes.length > 3 && <span className="px-1 py-0.5">+{p.themes.length - 3} more</span>}
                        <span className="ml-auto text-zinc-300 group-open:hidden">show sources ▸</span>
                      </div>
                    </summary>
                    <div className="ml-7 mt-2 rounded-lg bg-zinc-50 p-3 text-[12px]">
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">Where: {p.communities.map((c) => `r/${c.key} (${c.count})`).join(" · ")}</div>
                      <ul className="space-y-0.5">
                        {p.examples.map((e, j) => (
                          <li key={j}><a href={e.url} target="_blank" rel="noreferrer" className="text-zinc-700 underline decoration-zinc-300 hover:text-zinc-900">{e.title}</a> <span className="text-zinc-400">· r/{e.subreddit}</span></li>
                        ))}
                      </ul>
                    </div>
                  </details>
                </li>
              ))}
              {data.problems.length === 0 && <li className="text-[12px] text-zinc-400">No classified conversations yet.</li>}
            </ol>
          </Panel>

          <Panel title="Key findings" sub={synthesis.generatedAt ? `AI synthesis · ${fmtDate(synthesis.generatedAt)}` : "AI synthesis"}>
            {synthesis.markdown ? (
              <div className="space-y-1.5 text-[12px] leading-relaxed">{renderMarkdown(synthesis.markdown)}</div>
            ) : <div className="text-[12px] text-zinc-400">Not generated yet.</div>}
            <div className="mt-3 flex gap-2 border-t border-zinc-100 pt-3">
              <ActionButton label="Regenerate findings" action={regenerateSynthesisAction} className="rounded-md border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50" />
              <ActionButton label="Classify new conversations" action={backfillInsightsAction} className="rounded-md border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50" />
            </div>
          </Panel>

          <Panel title="Treatments × struggles" sub="conversations mentioning both">
            {data.treatmentByStruggle.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr>
                      <th className="py-1 pr-2 text-left font-medium text-zinc-400">Treatment</th>
                      {struggleCols.map((t) => <th key={t} className="px-1 py-1 text-left font-medium text-zinc-400"><div className="max-w-[80px] leading-tight">{STRUGGLE_LABELS[t as StruggleTag] ?? t}</div></th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.treatmentByStruggle.map((row) => (
                      <tr key={row.treatment} className="border-t border-zinc-100">
                        <td className="py-1.5 pr-2 font-medium text-zinc-700">{row.treatment}</td>
                        {row.cells.map((c) => (
                          <td key={c.tag} className="px-1 py-1.5">
                            <span className="inline-block min-w-7 rounded-md px-1.5 py-0.5 text-center tabular-nums" style={{ background: c.count ? `rgba(79,70,229,${0.12 + 0.75 * (c.count / matrixMax)})` : "transparent", color: c.count / matrixMax > 0.5 ? "#fff" : "#52525b" }}>{c.count || "·"}</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="text-[12px] text-zinc-400">No treatment data yet.</div>}
          </Panel>
        </div>

        <div className="space-y-5 xl:col-span-2">
          <Panel title="Data & method" sub="how the numbers are made">
            <dl className="space-y-3 text-[12px]">
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Source pool</dt>
                <dd className="mt-1"><Bars rows={m.sources.map((s) => ({ key: `r/${s.key}`, count: s.count }))} unit={(n) => `${n} conv.`} /></dd>
                <dd className="mt-1 text-[11px] text-zinc-400">Monitored: {m.monitoredCommunities.map((c) => `r/${c}`).join(", ")}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">How recent</dt>
                <dd className="mt-1 grid grid-cols-4 gap-1">
                  {m.recency.map((r) => (
                    <div key={r.label} className="text-center">
                      <div className="mx-auto flex h-10 w-full items-end rounded bg-zinc-50"><div className="w-full rounded" style={{ height: `${Math.max(4, (r.count / recencyMax) * 100)}%`, background: ACCENT, opacity: 0.8 }} /></div>
                      <div className="mt-0.5 text-[11px] font-semibold tabular-nums text-zinc-800">{r.count}</div>
                      <div className="text-[9px] text-zinc-400">{r.label}</div>
                    </div>
                  ))}
                </dd>
                <dd className="mt-1 text-[11px] text-zinc-400">Discovery only ingests posts ≤ {m.scanWindowDays} days old; every 30 min it re-checks tracked threads for new comments.</dd>
              </div>
              <details>
                <summary className="cursor-pointer text-[10px] font-medium uppercase tracking-wider text-zinc-400">Search terms ({m.searchTerms}) ▸</summary>
                <div className="mt-1 space-y-1">
                  {m.searchCategories.map((c) => (
                    <div key={c.name}><span className="text-[11px] font-medium text-zinc-600">{c.name}: </span><span className="text-[11px] text-zinc-400">{c.terms.join(" · ")}</span></div>
                  ))}
                </div>
              </details>
              <div>
                <dt className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Classification</dt>
                <dd className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                  Each conversation (post + comments) is read by <span className="font-medium text-zinc-700">{m.model}</span>, which writes a one-line problem, up to 3 struggle tags from a fixed {m.taxonomySize}-item taxonomy, and the unmet need. Percentages = conversations carrying a tag ÷ analyzed conversations ({totals.analyzed}), so they can sum above 100%. Mock/demo data is excluded{includeMock ? " (currently shown)" : ""}; self-reported minors are never engaged but still count as signal.
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Unmet needs" sub="in their words, one line each">
            <ul className="space-y-2">
              {data.unmetNeeds.slice(0, 8).map((u, i) => (
                <li key={i} className="flex gap-2 text-[12px] leading-snug text-zinc-700">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ACCENT }} />
                  <span>{u.text} <a href={u.url} target="_blank" rel="noreferrer" className="whitespace-nowrap text-[10px] text-zinc-400 hover:text-zinc-700">r/{u.subreddit} ↗</a></span>
                </li>
              ))}
              {data.unmetNeeds.length === 0 && <li className="text-[12px] text-zinc-400">None recorded yet.</li>}
            </ul>
          </Panel>

          <Panel title="Who they are" sub="from the analysis">
            <div className="space-y-4">
              <div><div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">Intent</div><Bars rows={data.intents.map((r) => ({ key: r.key.replace(/_/g, " ").toLowerCase(), count: r.count }))} /></div>
              <div><div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">Treatments mentioned</div><Bars rows={data.treatments.slice(0, 7)} unit={(n) => `${n} ${n === 1 ? "person" : "people"}`} /></div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
