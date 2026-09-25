import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { Card } from "@/components/Funnel";
import { ActionButton } from "@/components/buttons";
import { runDiscoveryAction, runCopilotAction, refreshAllAction } from "./actions";

export const dynamic = "force-dynamic";

const PENDING = ["PROPOSED", "APPROVAL_REQUESTED"] as const;
const READY = ["APPROVED", "EXECUTING", "MANUAL_REQUIRED"] as const;

function ago(d: Date | null) {
  if (!d) return "never";
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const EVENT_TEXT: Partial<Record<string, (who: string, where: string) => string>> = {
  LEAD_DISCOVERED: (who, where) => `Found ${who} in ${where}`,
  LEAD_QUALIFIED: (who) => `Analyzed ${who}`,
  ACTION_GENERATED: (who) => `Drafted a reply for ${who}`,
  ACTION_APPROVAL_REQUESTED: (who) => `Asked you to approve a reply to ${who}`,
  ACTION_APPROVED: (who) => `You approved the reply to ${who}`,
  ACTION_REJECTED: (who) => `You rejected the reply to ${who}`,
  ACTION_SNOOZED: (who) => `You snoozed ${who}`,
  COMMENT_POSTED: (who) => `You posted a reply to ${who}`,
  USER_REPLIED: (who) => `${who} replied to you`,
  FOLER_RELEVANCE_DETECTED: (who) => `${who} asked something FOLĒR could help with`,
  PERMISSION_REQUESTED: (who) => `Asked ${who} if they want to hear about FOLĒR`,
  PERMISSION_GRANTED: (who) => `${who} said yes to hearing about FOLĒR`,
  FOLER_INTRODUCED: (who) => `Introduced FOLĒR to ${who}`,
  WAITLIST_INVITED: (who) => `Sent ${who} the waitlist link`,
  WAITLIST_CLICKED: (who) => `${who} opened the waitlist link`,
  WAITLIST_SIGNUP: (who) => `${who} joined the waitlist`,
  OUTBOUND_PAUSED: () => "Outbound paused",
  OUTBOUND_RESUMED: () => "Outbound resumed",
  PROVIDER_ERROR: () => "Reddit request failed",
};

export default async function HomePage() {
  const [approve, ready, replied, noDraft, health, events, lastRunAt, signups, waitingCount, peopleCount, approveTotal, readyTotal, repliedTotal] = await Promise.all([
    prisma.action.findMany({
      where: { status: { in: [...PENDING] }, conversation: { lead: { isMock: false, doNotContact: false } } },
      include: { conversation: { include: { lead: true } } },
      orderBy: { conversation: { lead: { leadScore: "desc" } } },
      take: 5,
    }),
    prisma.action.findMany({
      where: { status: { in: [...READY] }, conversation: { lead: { isMock: false } } },
      include: { conversation: { include: { lead: true } } },
      orderBy: { approvedAt: "desc" },
      take: 5,
    }),
    prisma.conversation.findMany({
      where: { stage: "ACTIVE_CONVERSATION", lead: { isMock: false } },
      include: { lead: true },
      orderBy: { lastActivityAt: "desc" },
      take: 5,
    }),
    prisma.conversation.count({
      where: { lead: { isMock: false, doNotContact: false }, stage: "QUALIFIED", actions: { none: {} }, lastAnalysis: { path: ["recommended_action"], not: "IGNORE" } },
    }),
    prisma.accountHealth.findUnique({ where: { id: "default" } }),
    prisma.event.findMany({
      where: { type: { notIn: ["STAGE_CHANGED"] }, OR: [{ lead: { isMock: false } }, { leadId: null }] },
      include: { lead: { select: { redditUsername: true, subreddit: true } } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    getSetting("scheduler.lastRunAt", ""),
    prisma.conversion.count({ where: { signedUpAt: { not: null } } }),
    prisma.conversation.count({ where: { stage: { in: ["HELPING", "WAITING_FOR_RESPONSE", "ENGAGED"] }, lead: { isMock: false } } }),
    prisma.conversation.count({ where: { lead: { isMock: false } } }),
    prisma.action.count({ where: { status: { in: [...PENDING] }, conversation: { lead: { isMock: false, doNotContact: false } } } }),
    prisma.action.count({ where: { status: { in: [...READY] }, conversation: { lead: { isMock: false } } } }),
    prisma.conversation.count({ where: { stage: "ACTIVE_CONVERSATION", lead: { isMock: false } } }),
  ]);

  const todos = [
    {
      n: approveTotal,
      title: "need your approval",
      hint: "Read the drafted reply, edit if you like, approve or reject.",
      href: "/outreach",
      cta: "Review",
      people: approve.map((a) => ({ id: a.conversation.id, who: a.conversation.lead.redditUsername, score: a.conversation.lead.leadScore, sub: a.conversation.subreddit })),
    },
    {
      n: readyTotal,
      title: "approved, waiting for you to post",
      hint: "Copy the text, open the thread, paste it from your Reddit account, then mark it posted.",
      href: "/outreach",
      cta: "Post",
      people: ready.map((a) => ({ id: a.conversation.id, who: a.conversation.lead.redditUsername, score: a.conversation.lead.leadScore, sub: a.conversation.subreddit })),
    },
    {
      n: repliedTotal,
      title: "replied to you",
      hint: "Someone answered your comment. Draft a follow-up (FOLĒR only if they ask).",
      href: "/outreach",
      cta: "Follow up",
      people: replied.map((c) => ({ id: c.id, who: c.lead.redditUsername, score: c.lead.leadScore, sub: c.subreddit })),
    },
  ];
  const quiet = todos.every((t) => t.n === 0) && noDraft === 0;
  const lastRun = lastRunAt ? new Date(lastRunAt) : null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Today</h1>
          <p className="text-[13px] text-zinc-500">
            {peopleCount} people heard · {waitingCount} waiting on a reply · {signups} joined the waitlist
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-zinc-500">
          <span className={`rounded-full px-2 py-0.5 ${health?.outboundPaused ? "bg-red-100 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
            {health?.outboundPaused ? "Outbound paused" : "All systems normal"}
          </span>
          <span>Agent last ran {ago(lastRun)}</span>
        </div>
      </header>

      {quiet ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-[13px] text-zinc-500">
          Nothing needs you right now. The agent keeps listening every 30 minutes.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {todos.map((t) => (
            <section key={t.title} className={`card p-4 ${t.n ? "" : "opacity-60"}`}>
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="text-2xl font-semibold tabular-nums">{t.n}</span>
                  <span className="ml-2 text-[13px] text-zinc-700">{t.title}</span>
                </div>
                {t.n > 0 && (
                  <Link href={t.href} className="btn rounded-md bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-zinc-700">
                    {t.cta} →
                  </Link>
                )}
              </div>
              <p className="mt-1 text-[12px] text-zinc-500">{t.hint}</p>
              {t.people.length > 0 && (
                <ul className="mt-3 space-y-1 text-[12px]">
                  {t.people.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <Link href={`/conversations/${p.id}`} className="truncate text-zinc-800 hover:underline">u/{p.who}</Link>
                      <span className="shrink-0 text-zinc-400">r/{p.sub} · {p.score}</span>
                    </li>
                  ))}
                  {t.n > t.people.length && <li className="text-zinc-400">+{t.n - t.people.length} more</li>}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      <div className="card grid grid-cols-1 gap-4 p-4 text-[12px] text-zinc-500 md:grid-cols-3">
        <div className="space-y-1.5">
          <ActionButton label="Find new people" action={runDiscoveryAction} />
          <p>Search the monitored communities for new posts and read them. Runs by itself every 30 min.</p>
        </div>
        <div className="space-y-1.5">
          <ActionButton label={noDraft ? `Draft replies (${noDraft} waiting)` : "Draft replies"} action={runCopilotAction} />
          <p>Claude drafts a helpful reply for every analyzed person without one. Nothing is posted.</p>
        </div>
        <div className="space-y-1.5">
          <ActionButton label="Check for replies" action={refreshAllAction} />
          <p>Re-read the threads you posted in and pick up new replies.</p>
        </div>
      </div>

      <Card title="What the agent did recently">
        <ul className="divide-y divide-zinc-100 text-[12px]">
          {events.map((e) => {
            const who = e.lead ? `u/${e.lead.redditUsername}` : "someone";
            const where = e.lead ? `r/${e.lead.subreddit}` : "";
            const text = EVENT_TEXT[e.type]?.(who, where) ?? e.type.toLowerCase().replace(/_/g, " ");
            const inner = (
              <>
                <span className="truncate text-zinc-700">{text}</span>
                <span className="shrink-0 text-[11px] text-zinc-400">{ago(e.createdAt)}</span>
              </>
            );
            return (
              <li key={e.id} className="py-1.5">
                {e.conversationId ? (
                  <Link href={`/conversations/${e.conversationId}`} className="flex justify-between gap-3 hover:underline">{inner}</Link>
                ) : (
                  <div className="flex justify-between gap-3">{inner}</div>
                )}
              </li>
            );
          })}
          {events.length === 0 && <li className="py-2 text-zinc-400">Nothing yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
