import { prisma } from "@/lib/db";
import { STRUGGLE_TAGS, STRUGGLE_LABELS, type StruggleTag } from "./taxonomy";

export interface InsightRow {
  id: string;
  leadId: string;
  subreddit: string;
  title: string;
  url: string;
  createdAt: Date;
  analyzed: boolean;
  problemTheme: string;
  struggleTags: string[];
  unmetNeed: string;
  intent: string;
  hairConcern: string;
  treatment: string;
}

export function groupThemes(rows: InsightRow[]) {
  const map = new Map<string, { theme: string; count: number; communities: Set<string>; intents: Record<string, number>; examples: { title: string; url: string; subreddit: string }[] }>();
  for (const r of rows) {
    const theme = r.problemTheme.trim().toLowerCase();
    if (!theme) continue;
    const g = map.get(theme) ?? { theme, count: 0, communities: new Set<string>(), intents: {}, examples: [] };
    g.count++;
    if (r.subreddit) g.communities.add(r.subreddit);
    if (r.intent) g.intents[r.intent] = (g.intents[r.intent] ?? 0) + 1;
    if (g.examples.length < 3) g.examples.push({ title: r.title, url: r.url, subreddit: r.subreddit });
    map.set(theme, g);
  }
  const total = rows.filter((r) => r.problemTheme.trim()).length || 1;
  return [...map.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
    .map((g) => ({ ...g, share: Math.round((g.count / total) * 1000) / 10, communities: [...g.communities] }));
}

export function groupStruggles(rows: InsightRow[]) {
  const counts = new Map<string, number>();
  let tagged = 0;
  for (const r of rows) {
    if (!r.struggleTags.length) continue;
    tagged++;
    for (const t of r.struggleTags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return STRUGGLE_TAGS.filter((t) => counts.has(t))
    .map((t: StruggleTag) => ({
      tag: t,
      label: STRUGGLE_LABELS[t],
      count: counts.get(t) ?? 0,
      share: Math.round(((counts.get(t) ?? 0) / Math.max(1, tagged)) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);
}

export function countBy(rows: InsightRow[], key: (r: InsightRow) => string): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r).trim();
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

export function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function computeInsights(opts?: { includeMock?: boolean; sinceDays?: number }) {
  const where = {
    ...(opts?.includeMock ? {} : { lead: { isMock: false }, source: { not: "MOCK" as const } }),
    ...(opts?.sinceDays ? { createdAt: { gte: new Date(Date.now() - opts.sinceDays * 864e5) } } : {}),
  };
  const convos = await prisma.conversation.findMany({
    where,
    include: { lead: { select: { intent: true, hairConcern: true, treatment: true } } },
    orderBy: { createdAt: "desc" },
  });
  const rows: InsightRow[] = convos.map((c) => ({
    id: c.id,
    leadId: c.leadId,
    subreddit: c.subreddit,
    title: c.title,
    url: c.redditUrl,
    createdAt: c.createdAt,
    analyzed: c.lastAnalyzedAt !== null,
    problemTheme: c.problemTheme,
    struggleTags: c.struggleTags,
    unmetNeed: c.unmetNeed,
    intent: c.lead.intent ?? "",
    hairConcern: c.lead.hairConcern ?? "",
    treatment: c.lead.treatment ?? "",
  }));

  const totals = {
    conversations: rows.length,
    people: new Set(rows.map((r) => r.leadId)).size,
    communities: new Set(rows.map((r) => r.subreddit)).size,
    analyzed: rows.filter((r) => r.analyzed).length,
  };

  const struggles = groupStruggles(rows);
  const topTreatments = countBy(rows, (r) => r.treatment).slice(0, 6).map((t) => t.key);
  const treatmentByStruggle = topTreatments.map((treatment) => ({
    treatment,
    cells: STRUGGLE_TAGS.filter((t) => struggles.some((s) => s.tag === t)).map((tag) => ({
      tag,
      count: rows.filter((r) => r.treatment.trim() === treatment && r.struggleTags.includes(tag)).length,
    })),
  }));

  const weekMap = new Map<string, { conversations: number; struggles: Map<string, number> }>();
  for (const r of rows) {
    const w = isoWeek(r.createdAt);
    const e = weekMap.get(w) ?? { conversations: 0, struggles: new Map<string, number>() };
    e.conversations++;
    for (const t of r.struggleTags) e.struggles.set(t, (e.struggles.get(t) ?? 0) + 1);
    weekMap.set(w, e);
  }
  const weekly = [...weekMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)
    .map(([week, e]) => ({
      week,
      conversations: e.conversations,
      topStruggle: [...e.struggles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
    }));

  return {
    totals,
    themes: groupThemes(rows),
    struggles,
    intents: countBy(rows, (r) => r.intent),
    hairConcerns: countBy(rows, (r) => r.hairConcern),
    treatments: countBy(rows, (r) => r.treatment),
    communities: countBy(rows, (r) => r.subreddit),
    treatmentByStruggle,
    unmetNeeds: rows.filter((r) => r.unmetNeed.trim()).slice(0, 20).map((r) => ({ text: r.unmetNeed, subreddit: r.subreddit, url: r.url })),
    weekly,
  };
}
