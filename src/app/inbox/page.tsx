import Link from "next/link";
import { prisma } from "@/lib/db";
import type { AnalysisResult } from "@/lib/ai/types";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const CATEGORIES = ["HOT", "WARM", "COLD", "IGNORE"];
const STAGES = ["DISCOVERED", "QUALIFIED", "APPROVAL_PENDING", "HELPING", "ENGAGED", "WAITING_FOR_RESPONSE", "ACTIVE_CONVERSATION", "FOLER_RELEVANT", "FOLER_INTRODUCED", "WAITLIST_INVITED", "WAITLIST_SIGNUP"];
const INTENTS = ["MEASUREMENT", "UNCERTAINTY", "TREATMENT_JOURNEY", "HAIR_PROBLEM", "PRODUCT_INTENT", "OTHER"];

const catClass: Record<string, string> = {
  HOT: "bg-red-100 text-red-700",
  WARM: "bg-amber-100 text-amber-800",
  COLD: "bg-sky-100 text-sky-700",
  IGNORE: "bg-zinc-100 text-zinc-500",
};

export default async function InboxPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const where: Prisma.LeadWhereInput = {
    ...(searchParams.category ? { category: searchParams.category as never } : {}),
    ...(searchParams.subreddit ? { subreddit: searchParams.subreddit } : {}),
    ...(searchParams.intent ? { intent: searchParams.intent as never } : {}),
    ...(searchParams.treatment ? { treatment: { contains: searchParams.treatment, mode: "insensitive" } } : {}),
    ...(searchParams.stage ? { stage: searchParams.stage as never } : {}),
    ...(searchParams.minRelevance ? { relevanceScore: { gte: Number(searchParams.minRelevance) } } : {}),
    ...(searchParams.since ? { lastActivityAt: { gte: new Date(searchParams.since) } } : {}),
  };
  if (searchParams.action) {
    where.conversations = { some: { lastAnalysis: { path: ["recommended_action"], equals: searchParams.action } } };
  }
  const [leads, subredditRows] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { leadScore: "desc" },
      take: 200,
      include: { conversations: { orderBy: { lastActivityAt: "desc" }, take: 1 } },
    }),
    prisma.lead.findMany({ select: { subreddit: true }, distinct: ["subreddit"] }),
  ]);
  const subreddits = subredditRows.map((s) => s.subreddit);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Inbox</h1>
      <form className="flex flex-wrap items-center gap-2 text-[12px]">
        <select name="category" defaultValue={searchParams.category ?? ""} className="rounded border border-zinc-300 px-2 py-1">
          <option value="">category</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select name="subreddit" defaultValue={searchParams.subreddit ?? ""} className="rounded border border-zinc-300 px-2 py-1">
          <option value="">subreddit</option>
          {subreddits.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select name="intent" defaultValue={searchParams.intent ?? ""} className="rounded border border-zinc-300 px-2 py-1">
          <option value="">intent</option>
          {INTENTS.map((i) => <option key={i}>{i}</option>)}
        </select>
        <select name="stage" defaultValue={searchParams.stage ?? ""} className="rounded border border-zinc-300 px-2 py-1">
          <option value="">stage</option>
          {STAGES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <input name="treatment" placeholder="treatment" defaultValue={searchParams.treatment ?? ""} className="w-28 rounded border border-zinc-300 px-2 py-1" />
        <input name="action" placeholder="action" defaultValue={searchParams.action ?? ""} className="w-28 rounded border border-zinc-300 px-2 py-1" />
        <input name="minRelevance" placeholder="min relevance" defaultValue={searchParams.minRelevance ?? ""} className="w-24 rounded border border-zinc-300 px-2 py-1" />
        <input name="since" type="date" defaultValue={searchParams.since ?? ""} className="rounded border border-zinc-300 px-2 py-1" />
        <button className="rounded bg-zinc-900 px-3 py-1 text-white">Filter</button>
      </form>

      <table className="w-full border-collapse rounded-lg border border-zinc-200 bg-white text-[12px]">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-400">
            {["Person", "Subreddit", "Problem", "Intent", "Score", "Category", "Recommended", "Stage", "FOLĒR rel.", "Last activity"].map((h) => (
              <th key={h} className="px-3 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => {
            const convo = l.conversations[0];
            const analysis = convo?.lastAnalysis as unknown as AnalysisResult | null;
            return (
              <tr key={l.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                <td className="px-3 py-2">
                  {convo ? (
                    <Link href={`/conversations/${convo.id}`} className="font-medium text-zinc-800 hover:underline">
                      u/{l.redditUsername}
                    </Link>
                  ) : (
                    `u/${l.redditUsername}`
                  )}
                  {l.isMock && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] text-amber-800">MOCK</span>}
                </td>
                <td className="px-3 py-2">r/{l.subreddit}</td>
                <td className="max-w-56 truncate px-3 py-2 text-zinc-500">{l.problem || "—"}</td>
                <td className="px-3 py-2">{l.intent}</td>
                <td className="px-3 py-2 tabular-nums">{l.leadScore}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${catClass[l.category]}`}>{l.category}</span>
                </td>
                <td className="px-3 py-2">{analysis?.recommended_action ?? "—"}</td>
                <td className="px-3 py-2">{l.stage}</td>
                <td className="px-3 py-2 tabular-nums">{l.relevanceScore}</td>
                <td className="px-3 py-2 text-zinc-400">{l.lastActivityAt.toISOString().slice(0, 16).replace("T", " ")}</td>
              </tr>
            );
          })}
          {leads.length === 0 && (
            <tr><td colSpan={10} className="px-3 py-6 text-center text-zinc-400">No leads match.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
