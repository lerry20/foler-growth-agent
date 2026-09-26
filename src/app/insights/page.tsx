import Link from "next/link";
import { computeInsights } from "@/lib/insights/aggregate";
import { getSynthesis } from "@/lib/insights/synthesis";
import { STRUGGLE_LABELS, type StruggleTag } from "@/lib/insights/taxonomy";
import { ActionButton } from "@/components/buttons";
import { regenerateSynthesisAction } from "../actions";
import { Inter } from "next/font/google";
import { Reveal, Metric, Voices, Rings, Ranked, Flow } from "./Visuals";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const dynamic = "force-dynamic";

function renderMarkdown(md: string) {
  const nodes: React.ReactNode[] = [];
  const inline = (s: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) => (p.startsWith("**") ? <strong key={i} className="font-semibold text-white">{p.slice(2, -2)}</strong> : p));
  };
  md.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t || t === "---") return;
    if (t.startsWith("#")) nodes.push(<h3 key={i} className="pulse-eyebrow mt-4 first:mt-0">{t.replace(/^#+\s*/, "")}</h3>);
    else if (/^[-*]\s/.test(t)) nodes.push(<li key={i} className="pulse-body ml-4 list-disc">{inline(t.replace(/^[-*]\s*/, ""))}</li>);
    else if (/^\d+\.\s/.test(t)) nodes.push(<li key={i} className="pulse-body ml-4 list-decimal">{inline(t.replace(/^\d+\.\s*/, ""))}</li>);
    else nodes.push(<p key={i} className="pulse-body">{inline(t)}</p>);
  });
  return nodes;
}

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

function Head({ title, sub, tone }: { title: string; sub?: string; tone?: "warn" | "good" }) {
  return (
    <div className="pulse-head">
      <h2 className="pulse-title">{title}</h2>
      {sub && <span className="pulse-eyebrow" data-tone={tone}>{sub}</span>}
    </div>
  );
}

function Bars({ rows, max, unit }: { rows: { key: string; count: number }[]; max?: number; unit?: (n: number) => string }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
          <span className="truncate text-[13px]">{r.key}</span>
          <span className="pulse-muted text-[12px] tabular-nums">{unit ? unit(r.count) : r.count}</span>
          <div className="pulse-track col-span-2" style={{ height: 4 }}>
            <div className="pulse-fill" data-tone={i === 0 ? undefined : "dim"} style={{ width: `${(r.count / m) * 100}%`, transitionDelay: `${i * 60}ms` }} />
          </div>
        </div>
      ))}
      {rows.length === 0 && <div className="pulse-muted text-[13px]">No data yet.</div>}
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
  const flowRight = data.problems.slice(0, 6).map((p) => p.label);
  const flowLinks = data.problems.slice(0, 6).flatMap((p) => p.communities.map((c) => ({ from: c.key, to: p.label, value: c.count })));
  const flowLeft = data.communities.filter((c) => flowLinks.some((l) => l.from === c.key)).map((c) => c.key);
  const dateLabel = m.firstAt && m.lastAt ? `${fmtDate(m.firstAt)} — ${fmtDate(m.lastAt)}` : "no data";
  const top = data.problems[0];

  return (
    <div className={`pulse ${inter.className}`}>
      <div className="pulse-wrap pulse-grid">
        <Reveal hue="hero" className="col-span-12">
          <Rings />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full" style={{ background: "#b9d6b9", boxShadow: "0 0 12px 2px rgba(185,214,185,0.5)" }} />
              <span className="pulse-eyebrow">FOLĒR Pulse · population listening · hair &amp; scalp</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {["7", "30", "90", "all"].map((d) => (
                <Link key={d} href={qs(includeMock, d)} className="pulse-pill" data-on={daysParam === d}>{d === "all" ? "All time" : `${d} days`}</Link>
              ))}
              <Link href={qs(!includeMock, daysParam)} className="pulse-pill" data-on={includeMock} title={includeMock ? "Demo data is included — click to show real posts only" : "Real posts only — click to include demo data"}>{includeMock ? "Hide demo data" : "Show demo data"}</Link>
            </div>
          </div>
          <h1 className="pulse-h1 relative mt-10 max-w-4xl">
            What people struggle with<br /><span className="dim">before they reach a clinic.</span>
          </h1>
          <p className="pulse-lead relative mt-6">
            Every day people describe unmet health needs in public. Pulse reads those conversations, maps the problems at population level, and helps each person — with a human approving every reply.
          </p>
          <div className="pulse-pipeline relative mt-6">
            <span><b>Search</b> {m.monitoredCommunities.length} communities · {m.searchTerms} terms</span>
            <span><b>Keep</b> ≤ {m.scanWindowDays} days · unseen</span>
            <span><b>Read</b> post + comments</span>
            <span><b>Classify</b> with Claude</span>
            <span><b>Reply</b> only with human approval</span>
          </div>
          <div className="relative mt-12 grid grid-cols-2 gap-8 md:grid-cols-4">
            <Metric value={totals.people} label="people heard" sub={`${m.posts} posts · ${m.comments} comments read`} />
            <Metric value={totals.analyzed} label="people analyzed" sub={`${totals.conversations} threads · ${totals.analyzedCommenters} from comments · ${totals.communities} communities`} />
            <Metric value={data.unmetNeeds.length} label="unmet needs mapped" sub={dateLabel} />
            <div>
              <div className="pulse-metric">{top ? `${top.share}%` : "—"}</div>
              <div className="pulse-eyebrow mt-3" data-tone="warn">top struggle</div>
              <div className="pulse-muted mt-1 text-[12px]">{top ? top.label : "no data yet"} · {m.confidence}</div>
            </div>
          </div>
        </Reveal>

        <Reveal className="col-span-12 xl:col-span-7" delay={60}>
          <Head title="What they struggle with" sub={`share of ${totals.analyzed} people describing their own case · up to 3 tags each`} />
          <Ranked total={totals.analyzed} items={data.problems.map((p) => ({ label: p.label, count: p.count, share: p.share, communities: p.communities, themes: p.themes, examples: p.examples }))} />
        </Reveal>

        <div className="col-span-12 flex flex-col gap-6 xl:col-span-5">
          <Reveal hue="sage" className="flex-1" delay={120}>
            <Head title="In their words" sub="unmet needs · live" tone="good" />
            <Voices quotes={data.unmetNeeds} />
          </Reveal>
          <Reveal hue="slate" delay={180}>
            <Head title="Key findings" sub={synthesis.generatedAt ? `AI synthesis · ${fmtDate(synthesis.generatedAt)}` : "AI synthesis"} />
            {synthesis.markdown ? (
              <div className="pulse-scroll space-y-1.5 text-[13px]">{renderMarkdown(synthesis.markdown)}</div>
            ) : <div className="pulse-muted text-[13px]">Not generated yet.</div>}
            <div className="mt-5 flex gap-2">
              <ActionButton label="Rewrite findings from current data" title="Claude re-reads all classified conversations and rewrites this brief" action={regenerateSynthesisAction} className="pulse-btn" />
            </div>
          </Reveal>
        </div>

        <Reveal className="col-span-12 xl:col-span-7" delay={60}>
          <Head title="Where the signal comes from" sub="community → struggle · ribbon width = people" />
          <Flow left={flowLeft} right={flowRight} links={flowLinks} />
        </Reveal>

        <Reveal hue="slate" className="col-span-12 xl:col-span-5" delay={120}>
          <Head title="Data & method" sub="how the numbers are made" />
          <div className="space-y-5">
            <div>
              <div className="pulse-eyebrow mb-2">How posts are selected</div>
              <ol className="pulse-steps">
                <li><b>Pull</b> the newest posts from {m.monitoredCommunities.length} communities (up to 100 each per pass) — nothing is hand-picked.</li>
                <li><b>Keep</b> posts that mention one of {m.searchTerms} fixed terms, are ≤ {m.scanWindowDays} days old and that we have not read before.</li>
                <li><b>Read</b> the full thread: post + every comment.</li>
                <li><b>Classify</b> every person who describes their own case with {m.model} — the poster and each such commenter separately, from their own words; all {totals.analyzed} count, whether or not we reply.</li>
              </ol>
            </div>
            <div>
              <div className="pulse-eyebrow mb-2">Who counts as a person</div>
              <p className="pulse-muted text-[12px]">
                Every author in a thread — the original poster and each commenter — is read separately. Only people describing <i>their own</i> case are counted; advice to others, questions about someone else, sellers and off-topic are excluded. Anything unclear waits for a human, never enters the numbers.
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[18px] font-semibold tabular-nums">{m.voices.total}</div>
                  <div className="pulse-muted text-[11px]">people read · {m.voices.ops} posters · {m.voices.commenters} commenters</div>
                </div>
                <div>
                  <div className="text-[18px] font-semibold tabular-nums">{m.voices.ownCase}</div>
                  <div className="pulse-muted text-[11px]">describe their own case · {m.voices.ownCaseCommenters} from comments ({m.voices.commentersLabeled} labelled)</div>
                </div>
                <div>
                  <div className="text-[18px] font-semibold tabular-nums">{m.voices.pending}</div>
                  <div className="pulse-muted text-[11px]">awaiting judgement · {m.voices.excluded} excluded</div>
                </div>
              </div>
              <p className="pulse-muted mt-2 text-[11px]">
                {m.voices.labelsChecked} struggle labels and {m.voices.humanChecked} people verified by a human · <Link href="/audit" className="underline underline-offset-2">audit every decision →</Link>
              </p>
            </div>
            <div>
              <div className="pulse-eyebrow mb-2">Source pool</div>
              <Bars rows={m.sources.map((s) => ({ key: `r/${s.key}`, count: s.count }))} unit={(n) => `${n} conv.`} />
              <div className="pulse-muted mt-2 text-[12px]">Monitored: {m.monitoredCommunities.map((c) => `r/${c}`).join(", ")}</div>
            </div>
            <div>
              <div className="pulse-eyebrow mb-2">How recent</div>
              <div className="grid grid-cols-4 gap-2">
                {m.recency.map((r) => (
                  <div key={r.label} className="text-center">
                    <div className="flex h-14 w-full items-end overflow-hidden rounded-lg" style={{ background: "rgba(255,255,255,0.06)" }}><div className="w-full rounded-lg" style={{ height: `${Math.max(6, (r.count / recencyMax) * 100)}%`, background: "#dde5dd" }} /></div>
                    <div className="mt-1.5 text-[14px] font-semibold tabular-nums">{r.count}</div>
                    <div className="pulse-muted text-[10px]">{r.label}</div>
                  </div>
                ))}
              </div>
              <div className="pulse-muted mt-2 text-[12px]">Discovery runs every 30 min; threads we replied in are re-checked on the same schedule.</div>
            </div>
            <details>
              <summary className="pulse-eyebrow">Search terms ({m.searchTerms}) ▸</summary>
              <div className="mt-2 space-y-1">
                {m.searchCategories.map((c) => (
                  <div key={c.name} className="text-[12px]"><span className="font-medium">{c.name}: </span><span className="pulse-muted">{c.terms.join(" · ")}</span></div>
                ))}
              </div>
            </details>
            <div>
              <div className="pulse-eyebrow mb-2">Classification</div>
              <p className="pulse-body m-0 text-[12px]">
                Each thread (post + comments) is read by <span className="text-white">{m.model}</span>. Every person who describes their own case — the poster and each such commenter — gets up to 3 struggle tags from a fixed {m.taxonomySize}-item taxonomy, each backed by a verbatim quote from <i>their own</i> words; the poster also gets a one-line problem and unmet need. Percentages = people carrying a tag ÷ people analyzed ({totals.analyzed}), so they can sum above 100%. Mock/demo data is excluded{includeMock ? " (currently shown)" : ""}; self-reported minors are never engaged but still count as signal. Sample confidence: <span className="text-white">{m.confidence}</span>.
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal className="col-span-12 xl:col-span-7" delay={60}>
          <Head title="Treatments × struggles" sub="conversations mentioning both" />
          {data.treatmentByStruggle.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr>
                    <th className="pulse-muted py-1 pr-2 text-left font-medium">Treatment</th>
                    {struggleCols.map((t) => <th key={t} className="pulse-muted px-1 py-1 text-left font-medium"><div className="max-w-[80px] leading-tight">{STRUGGLE_LABELS[t as StruggleTag] ?? t}</div></th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.treatmentByStruggle.map((row) => (
                    <tr key={row.treatment} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                      <td className="py-2 pr-2 text-[12px] font-medium">{row.treatment}</td>
                      {row.cells.map((c) => (
                        <td key={c.tag} className="px-1 py-1.5">
                          <span className="cell" style={{ background: c.count ? `rgba(221,229,221,${0.1 + 0.85 * (c.count / matrixMax)})` : "transparent", color: c.count / matrixMax > 0.45 ? "#262827" : "rgba(255,255,255,0.6)" }}>{c.count || "·"}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="pulse-muted text-[13px]">No treatment data yet.</div>}
        </Reveal>

        <Reveal hue="sage" className="col-span-12 xl:col-span-5" delay={120}>
          <Head title="Who they are" sub="from the analysis" />
          <div className="space-y-6">
            <div><div className="pulse-eyebrow mb-2">Intent</div><Bars rows={data.intents.map((r) => ({ key: r.key.replace(/_/g, " ").toLowerCase(), count: r.count }))} /></div>
            <div><div className="pulse-eyebrow mb-2">Treatments mentioned</div><Bars rows={data.treatments.slice(0, 7)} unit={(n) => `${n} ${n === 1 ? "person" : "people"}`} /></div>
          </div>
        </Reveal>

        <Reveal className="col-span-12" delay={60}>
          <Head title="Unmet needs" sub="in their words, one line each" />
          <ul className="m-0 grid list-none gap-x-8 gap-y-3 p-0 md:grid-cols-2 xl:grid-cols-3">
            {data.unmetNeeds.slice(0, 12).map((u, i) => (
              <li key={i} className="flex gap-3 text-[13px] leading-snug">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "#dde5dd" }} />
                <span className="pulse-body">{u.text} <a href={u.url} target="_blank" rel="noreferrer" className="src whitespace-nowrap text-[11px]">r/{u.subreddit} ↗</a></span>
              </li>
            ))}
            {data.unmetNeeds.length === 0 && <li className="pulse-muted text-[13px]">None recorded yet.</li>}
          </ul>
        </Reveal>
      </div>
    </div>
  );
}
