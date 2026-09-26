import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { STRUGGLE_TAGS, STRUGGLE_LABELS, type StruggleTag } from "./taxonomy";
import { parseEvidence, type StruggleEvidence } from "./evidence";
import { applyLabelReviews } from "./labelReview";
import { effective, isCounted } from "@/lib/voices/review";

export { parseEvidence };

export interface SourceExample {
  title: string;
  url: string;
  subreddit: string;
  /** The person's verbatim words that earned this tag; empty for legacy rows classified before evidence was required. */
  quote: string;
  provider: string;
  human?: "confirmed" | "corrected" | "added";
}

export interface InsightRow {
  id: string;
  leadId: string;
  subreddit: string;
  title: string;
  url: string;
  createdAt: Date;
  postedAt: Date;
  commentCount: number;
  analyzed: boolean;
  problemTheme: string;
  struggleTags: string[];
  struggleEvidence: StruggleEvidence[];
  provider: string;
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

export interface ProblemCluster {
  tag: StruggleTag;
  label: string;
  count: number;
  share: number;
  communities: { key: string; count: number }[];
  themes: { theme: string; count: number }[];
  examples: SourceExample[];
}

export function groupProblems(rows: InsightRow[]): ProblemCluster[] {
  const analyzed = rows.filter((r) => r.analyzed).length || 1;
  const out: ProblemCluster[] = [];
  for (const tag of STRUGGLE_TAGS) {
    const hits = rows.filter((r) => r.struggleTags.includes(tag));
    if (!hits.length) continue;
    const themeMap = new Map<string, number>();
    for (const r of hits) {
      const t = r.problemTheme.trim().toLowerCase();
      if (t) themeMap.set(t, (themeMap.get(t) ?? 0) + 1);
    }
    out.push({
      tag,
      label: STRUGGLE_LABELS[tag],
      count: hits.length,
      share: Math.round((hits.length / analyzed) * 1000) / 10,
      communities: countBy(hits, (r) => r.subreddit),
      themes: [...themeMap.entries()].map(([theme, count]) => ({ theme, count })).sort((a, b) => b.count - a.count).slice(0, 5),
      examples: hits.slice(0, 12).map((r) => {
        const ev = r.struggleEvidence.find((e) => e.tag === tag);
        return {
          title: r.title,
          url: r.url,
          subreddit: r.subreddit,
          quote: ev?.quote ?? "",
          provider: r.provider,
          human: ev?.human,
        };
      }),
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

const TREATMENT_BUCKETS: [string, RegExp][] = [
  ["Finasteride / dutasteride", /finasteride|dutasteride|\bfin\b|\bdut\b|propecia/i],
  ["Oral minoxidil", /oral\s+min|minoxidil\s+\d|\bLDOM\b/i],
  ["Topical minoxidil", /topical\s+min|minoxidil\s*(5|2)%|rogaine|foam/i],
  ["Microneedling", /microneedl|dermaroll|derma\s*pen/i],
  ["Hair transplant", /transplant|\bFUE\b|\bFUT\b/i],
  ["Ketoconazole / shampoo", /ketoconazole|nizoral|shampoo/i],
  ["Supplements / PRP / other", /prp|biotin|supplement|spironolactone|pyrilutamide|RU58841|nutrafol/i],
];

export function normalizeTreatments(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  if (/^(none|nothing|no treatment|not (yet )?(on|treating)|n\/a)\b/i.test(t)) return ["No treatment yet"];
  const found = TREATMENT_BUCKETS.filter(([, re]) => re.test(t)).map(([label]) => label);
  if (/minoxidil/i.test(t) && !found.some((f) => f.includes("minoxidil"))) found.push("Topical minoxidil");
  if (/considering|planning|about to start|thinking/i.test(t) && !found.length) return ["No treatment yet"];
  return found.length ? found : ["Other / unspecified"];
}

export function countTreatments(rows: InsightRow[]): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) for (const k of normalizeTreatments(r.treatment)) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
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
  const [convos, categories, communityConfigs, voiceRows] = await Promise.all([
    prisma.conversation.findMany({
      where,
      include: {
        lead: { select: { intent: true, hairConcern: true, treatment: true } },
        messages: { select: { postedAt: true, isOriginalPost: true } },
        struggleReviews: { select: { tag: true, verdict: true, shouldBe: true, quote: true } },
        intentReview: { select: { intent: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.searchCategory.findMany({ where: { enabled: true }, select: { name: true, terms: true } }),
    prisma.communityConfig.findMany({ where: { enabled: true }, select: { name: true } }),
    prisma.voice.findMany({
      where: { conversation: where },
      select: {
        role: true,
        speaksAbout: true,
        inScope: true,
        gatedAt: true,
        needsReview: true,
        review: { select: { speaksAbout: true, inScope: true } },
      },
    }),
  ]);
  // A human verdict overrides the model; a voice is decided if either exists.
  const judged = voiceRows.map((v) => {
    const e = effective(v);
    const decided = e.source === "human" || (v.gatedAt !== null && !v.needsReview);
    return { role: v.role, decided, counted: decided && isCounted(e), human: e.source === "human" };
  });
  const voices = {
    total: judged.length,
    ops: judged.filter((v) => v.role === "OP").length,
    commenters: judged.filter((v) => v.role === "COMMENTER").length,
    ownCase: judged.filter((v) => v.counted).length,
    ownCaseCommenters: judged.filter((v) => v.role === "COMMENTER" && v.counted).length,
    excluded: judged.filter((v) => v.decided && !v.counted).length,
    pending: judged.filter((v) => !v.decided).length,
    humanChecked: judged.filter((v) => v.human).length,
    labelsChecked: 0,
  };
  // Human label verdicts override the engine: a label judged WRONG is dropped, a MISSED one added.
  voices.labelsChecked = convos.reduce((n, c) => n + c.struggleReviews.length, 0);
  const rows: InsightRow[] = convos.map((c) => ({
    id: c.id,
    leadId: c.leadId,
    subreddit: c.subreddit,
    title: c.title,
    url: c.redditUrl,
    createdAt: c.createdAt,
    postedAt: c.messages.find((m) => m.isOriginalPost)?.postedAt ?? c.createdAt,
    commentCount: c.messages.filter((m) => !m.isOriginalPost).length,
    analyzed: c.lastAnalyzedAt !== null,
    problemTheme: c.problemTheme,
    ...(() => {
      const r = applyLabelReviews(parseEvidence(c.struggleEvidence), c.struggleReviews);
      return { struggleTags: r.tags, struggleEvidence: r.evidence, provider: r.human ? "human" : c.analysisProvider ?? "" };
    })(),
    unmetNeed: c.unmetNeed,
    intent: c.intentReview?.intent ?? c.lead.intent ?? "",
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
  const treatments = countTreatments(rows);
  const topTreatments = treatments.slice(0, 7).map((t) => t.key);
  const treatmentByStruggle = topTreatments.map((treatment) => ({
    treatment,
    cells: STRUGGLE_TAGS.filter((t) => struggles.some((s) => s.tag === t)).map((tag) => ({
      tag,
      count: rows.filter((r) => normalizeTreatments(r.treatment).includes(treatment) && r.struggleTags.includes(tag)).length,
    })),
  }));

  const weekMap = new Map<string, { conversations: number; struggles: Map<string, number> }>();
  for (const r of rows) {
    const w = isoWeek(r.postedAt);
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

  const dates = rows.map((r) => r.postedAt.getTime());
  const now = Date.now();
  const ageDays = (r: InsightRow) => (now - r.postedAt.getTime()) / 864e5;
  const recency = [
    { label: "Last 7 days", count: rows.filter((r) => ageDays(r) <= 7).length },
    { label: "8–30 days", count: rows.filter((r) => ageDays(r) > 7 && ageDays(r) <= 30).length },
    { label: "31–90 days", count: rows.filter((r) => ageDays(r) > 30 && ageDays(r) <= 90).length },
    { label: "Older", count: rows.filter((r) => ageDays(r) > 90).length },
  ];
  const tagged = rows.filter((r) => r.struggleTags.length).length;
  const methodology = {
    monitoredCommunities: communityConfigs.map((c) => c.name),
    searchCategories: categories.map((c) => ({ name: c.name, terms: c.terms })),
    searchTerms: categories.reduce((n, c) => n + c.terms.length, 0),
    sources: countBy(rows, (r) => r.subreddit),
    posts: rows.length,
    comments: rows.reduce((n, r) => n + r.commentCount, 0),
    scanWindowDays: 90,
    recency,
    medianAgeDays: dates.length ? Math.round((now - [...dates].sort((a, b) => a - b)[Math.floor(dates.length / 2)]) / 864e5) : null,
    firstAt: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
    lastAt: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    analyzed: totals.analyzed,
    tagged,
    avgTagsPerConversation: tagged ? Math.round((rows.reduce((n, r) => n + r.struggleTags.length, 0) / tagged) * 10) / 10 : 0,
    model: env.ANTHROPIC_MODEL,
    taxonomySize: STRUGGLE_TAGS.length,
    confidence: totals.analyzed >= 100 ? "robust" : totals.analyzed >= 30 ? "emerging" : "early signal",
    includeMock: Boolean(opts?.includeMock),
    sinceDays: opts?.sinceDays ?? null,
    voices,
  } as const;

  return {
    totals,
    methodology,
    problems: groupProblems(rows),
    themes: groupThemes(rows),
    struggles,
    intents: countBy(rows, (r) => r.intent),
    hairConcerns: countBy(rows, (r) => r.hairConcern),
    treatments,
    communities: countBy(rows, (r) => r.subreddit),
    treatmentByStruggle,
    unmetNeeds: rows.filter((r) => r.unmetNeed.trim()).slice(0, 20).map((r) => ({ text: r.unmetNeed, subreddit: r.subreddit, url: r.url })),
    weekly,
  };
}
