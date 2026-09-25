export function Funnel({ steps }: { steps: { label: string; count: number }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <div className="space-y-1">
      {steps.map((s) => (
        <div key={s.label} className="flex items-center gap-3">
          <span className="w-32 shrink-0 text-[12px] text-zinc-500 sm:w-36">{s.label}</span>
          <div className="h-4 max-w-[300px] flex-1 overflow-hidden rounded-sm bg-zinc-100">
            <div className="h-full rounded-sm bg-sage-400" style={{ width: `${Math.max(1, (s.count / max) * 100)}%` }} />
          </div>
          <span className="w-8 text-right text-[12px] font-medium tabular-nums text-zinc-700">{s.count}</span>
        </div>
      ))}
    </div>
  );
}

export function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <h2 className={`text-[11px] font-semibold uppercase tracking-wider text-zinc-400 ${hint ? "mb-1" : "mb-3"}`}>{title}</h2>
      {hint && <p className="mb-3 text-[12px] text-zinc-500">{hint}</p>}
      {children}
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-zinc-500">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
