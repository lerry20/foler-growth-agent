"use client";

import { useEffect, useRef, useState } from "react";

function useInView<T extends HTMLElement>(margin = "-10% 0px") {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) { setOn(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setOn(true); io.disconnect(); } }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return { ref, on };
}

function useCountUp(target: number, run: boolean, ms = 1500) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 4))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, run]);
  return v;
}

/** Fades/slides children in when scrolled into view; children can key off data-active for their own animations. */
export function Reveal({ children, className = "", hue, delay = 0, style }: { children: React.ReactNode; className?: string; hue?: "slate" | "sage" | "hero"; delay?: number; style?: React.CSSProperties }) {
  const { ref, on } = useInView<HTMLElement>();
  return (
    <section ref={ref} data-active={on} data-hue={hue} className={`pulse-card pulse-reveal ${className}`} style={{ ...style, transitionDelay: `${delay}ms` }}>
      {children}
    </section>
  );
}

export function Metric({ value, label, sub }: { value: number; label: string; sub?: string }) {
  const { ref, on } = useInView<HTMLDivElement>();
  const v = useCountUp(value, on);
  return (
    <div ref={ref}>
      <div className="pulse-metric">{v.toLocaleString()}</div>
      <div className="pulse-eyebrow mt-3">{label}</div>
      {sub && <div className="pulse-muted mt-1 text-[12px]">{sub}</div>}
    </div>
  );
}

export interface Quote { text: string; subreddit: string; url: string }

export function Voices({ quotes, every = 6000 }: { quotes: Quote[]; every?: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (quotes.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % quotes.length), every);
    return () => clearInterval(t);
  }, [quotes.length, every]);
  const q = quotes[i];
  if (!q) return <div className="pulse-muted text-[13px]">No voices captured yet.</div>;
  return (
    <div className="flex h-full flex-col justify-between gap-6">
      <blockquote key={i} className="pulse-fade pulse-quote m-0">“{q.text}”</blockquote>
      <div className="flex items-center justify-between gap-4">
        <a href={q.url} target="_blank" rel="noreferrer" className="src text-[12px]">public post · r/{q.subreddit} ↗</a>
        <div className="flex gap-1.5">
          {quotes.slice(0, 12).map((_, j) => (
            <button key={j} aria-label={`quote ${j + 1}`} onClick={() => setI(j)} className="h-1.5 rounded-full transition-all" style={{ width: j === i ? 18 : 6, background: j === i ? "#dde5dd" : "rgba(255,255,255,0.2)" }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Slow concentric rings — the "listening" motif. Purely decorative. */
export function Rings({ size = 520 }: { size?: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute" style={{ width: size, height: size, right: -size * 0.35, top: -size * 0.25 }}>
      {[0, 1, 2, 3].map((k) => (
        <span key={k} className="pulse-ring" style={{ inset: 0, animationDelay: `${k * 1.5}s` }} />
      ))}
      <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: "#dde5dd", boxShadow: "0 0 24px 6px rgba(221,229,221,0.35)" }} />
    </div>
  );
}

export interface Rank {
  label: string;
  count: number;
  share: number;
  communities: { key: string; count: number }[];
  themes: { theme: string; count: number }[];
  examples: { title: string; url: string; subreddit: string; quote: string; provider: string; human?: "confirmed" | "corrected" | "added" }[];
}

export function Ranked({ items, total }: { items: Rank[]; total: number }) {
  if (!items.length) return <div className="pulse-muted text-[13px]">No classified conversations yet.</div>;
  return (
    <ol className="m-0 list-none space-y-4 p-0">
      {items.map((p, i) => (
        <li key={p.label}>
          <details className="group">
            <summary>
              <div className="flex items-baseline gap-4">
                <span className="pulse-muted w-6 text-[12px] tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <span className="flex-1 text-[15px] font-medium tracking-[-0.01em]">{p.label}</span>
                <span className="text-[22px] font-semibold tabular-nums tracking-[-0.03em]">{p.share}<span className="pulse-muted text-[13px] font-normal">%</span></span>
                <span className="pulse-muted w-14 text-right text-[12px] tabular-nums">{p.count} of {total}</span>
              </div>
              <div className="pulse-track mt-2.5 ml-10">
                <div className="pulse-fill" data-tone={i === 0 ? "warn" : i < 3 ? undefined : "dim"} style={{ width: `${p.share}%`, transitionDelay: `${i * 70}ms` }} />
              </div>
              <div className="pulse-muted ml-10 mt-1.5 flex gap-3 text-[11px]">
                <span className="truncate">{p.themes.slice(0, 2).map((t) => t.theme).join(" · ")}</span>
                <span className="ml-auto shrink-0 opacity-60 group-open:hidden">sources ▸</span>
              </div>
            </summary>
            <div className="ml-10 mt-3 grid gap-5 rounded-2xl p-4 text-[12px] md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div>
                <div className="pulse-eyebrow">Where</div>
                <div className="pulse-body mt-1">{p.communities.map((c) => `r/${c.key} · ${c.count}`).join("   ")}</div>
                <div className="pulse-eyebrow mt-3">How they say it</div>
                <ul className="pulse-body mt-1 m-0 list-none space-y-0.5 p-0">{p.themes.map((t) => <li key={t.theme}>{t.theme} <span className="pulse-muted">×{t.count}</span></li>)}</ul>
              </div>
              <div>
                <div className="pulse-eyebrow">Why each one counts · {p.count} {p.count === 1 ? "person" : "people"}, in their own words</div>
                <ul className="mt-1 m-0 list-none space-y-2 p-0">
                  {p.examples.map((e, j) => (
                    <li key={j} className="border-l pl-2.5" style={{ borderColor: "rgba(255,255,255,0.14)" }}>
                      {e.quote ? (
                        <div className="pulse-body italic">“{e.quote}”</div>
                      ) : e.human === "added" ? (
                        <div className="pulse-muted italic">added by a human reviewer — the engine missed it</div>
                      ) : (
                        <div className="pulse-muted italic">no quote recorded — tagged before evidence was required</div>
                      )}
                      <div className="pulse-muted mt-0.5 truncate">
                        <a href={e.url} target="_blank" rel="noreferrer" className="src">{e.title}</a> · r/{e.subreddit}
                        {e.human === "added" ? " · human-added" : e.human === "corrected" ? " · human-corrected (engine had it under another label)" : e.human === "confirmed" ? " · human-confirmed" : e.provider === "heuristic" ? " · keyword rule" : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}

export function Flow({ left, right, links }: { left: string[]; right: string[]; links: { from: string; to: string; value: number }[] }) {
  const W = 720, H = Math.max(220, Math.max(left.length, right.length) * 44 + 24);
  const lt = Object.fromEntries(left.map((k) => [k, links.filter((l) => l.from === k).reduce((n, l) => n + l.value, 0)]));
  const rt = Object.fromEntries(right.map((k) => [k, links.filter((l) => l.to === k).reduce((n, l) => n + l.value, 0)]));
  const sumL = Math.max(1, Object.values(lt).reduce((a, b) => a + b, 0)), sumR = Math.max(1, Object.values(rt).reduce((a, b) => a + b, 0));
  const gap = 10;
  const sL = (H - 24 - (left.length - 1) * gap) / sumL, sR = (H - 24 - (right.length - 1) * gap) / sumR;
  const ly: Record<string, number> = {}, ry: Record<string, number> = {};
  let y = 12; for (const k of left) { ly[k] = y; y += lt[k] * sL + gap; }
  y = 12; for (const k of right) { ry[k] = y; y += rt[k] * sR + gap; }
  const lo = { ...ly }, ro = { ...ry };
  if (!links.length) return <div className="pulse-muted text-[13px]">No data yet.</div>;
  const x1 = 170, x2 = W - 250, mx = (x1 + x2) / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {links.map((l, i) => {
        const h1 = l.value * sL, h2 = l.value * sR, y1 = lo[l.from], y2 = ro[l.to];
        lo[l.from] += h1; ro[l.to] += h2;
        const top = right.indexOf(l.to) === 0;
        const d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2} L${x2},${y2 + h2} C${mx},${y2 + h2} ${mx},${y1 + h1} ${x1},${y1 + h1} Z`;
        return <path key={i} d={d} fill={top ? "#e3c3a0" : "#dde5dd"} fillOpacity={top ? 0.42 : 0.16} stroke="#fff" strokeOpacity={0.18} strokeWidth={0.5}><title>{`r/${l.from} → ${l.to}: ${l.value}`}</title></path>;
      })}
      {left.map((k) => (
        <g key={k}>
          <rect x={x1 - 3} y={ly[k]} width={3} height={Math.max(2, lt[k] * sL)} rx={1.5} fill="#f4f3ee" />
          <text x={x1 - 12} y={ly[k] + Math.max(2, lt[k] * sL) / 2 + 4} textAnchor="end" fontSize={12} fontWeight={500} fill="#f4f3ee">r/{k} <tspan fillOpacity={0.45} fontWeight={400}>{lt[k]}</tspan></text>
        </g>
      ))}
      {right.map((k, i) => (
        <g key={k}>
          <rect x={x2} y={ry[k]} width={3} height={Math.max(2, rt[k] * sR)} rx={1.5} fill={i === 0 ? "#e3c3a0" : "#dde5dd"} />
          <text x={x2 + 12} y={ry[k] + Math.max(2, rt[k] * sR) / 2 + 4} fontSize={12} fontWeight={500} fill="#f4f3ee">{k} <tspan fillOpacity={0.45} fontWeight={400}>{rt[k]}</tspan></text>
        </g>
      ))}
    </svg>
  );
}
