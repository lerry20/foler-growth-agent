import { prisma } from "@/lib/db";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { funnelCounts } from "@/lib/funnel";
import { Funnel, Card, Stat } from "@/components/Funnel";
import { ActionButton } from "@/components/buttons";
import { runDiscoveryAction, runCopilotAction, refreshAllAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [
    postsScanned, relevantLeads, hotLeads, helpPosted, engagePosted, activeConvos,
    intros, invites, signups, pending, health, recentEvents,
  ] = await Promise.all([
    getSetting(SETTING_KEYS.discoveryPostsScanned, "0"),
    prisma.lead.count({ where: { category: { not: "IGNORE" } } }),
    prisma.lead.count({ where: { category: "HOT" } }),
    prisma.action.count({ where: { status: "POSTED", type: "HELP" } }),
    prisma.action.count({ where: { status: "POSTED", type: { in: ["ENGAGE", "FOLLOW_UP"] } } }),
    prisma.conversation.count({ where: { stage: { in: ["ACTIVE_CONVERSATION", "WAITING_FOR_RESPONSE"] } } }),
    prisma.event.count({ where: { type: "FOLER_INTRODUCED" } }),
    prisma.event.count({ where: { type: "WAITLIST_INVITED" } }),
    prisma.conversion.count({ where: { signedUpAt: { not: null } } }),
    prisma.action.count({ where: { status: { in: ["PROPOSED", "APPROVAL_REQUESTED", "MANUAL_REQUIRED"] } } }),
    prisma.accountHealth.findUnique({ where: { id: "default" } }),
    prisma.event.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const funnel = await funnelCounts();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Home</h1>
        <ActionButton label="Run discovery" action={runDiscoveryAction} />
        <ActionButton label="Run copilot" action={runCopilotAction} />
        <ActionButton label="Refresh conversations" action={refreshAllAction} />
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Card title="Discovery">
          <Stat label="Posts scanned" value={postsScanned} />
          <Stat label="Relevant posts" value={relevantLeads} />
          <Stat label="High-intent leads" value={hotLeads} />
        </Card>
        <Card title="Engagement">
          <Stat label="Helpful interactions" value={helpPosted} />
          <Stat label="Engagement interactions" value={engagePosted} />
          <Stat label="Active conversations" value={activeConvos} />
        </Card>
        <Card title="FOLĒR">
          <Stat label="Introductions" value={intros} />
          <Stat label="Waitlist invitations" value={invites} />
          <Stat label="Signups" value={signups} />
        </Card>
        <Card title="Operations">
          <Stat label="Pending approvals" value={pending} />
          <Stat label="Outbound" value={health?.outboundPaused ? "PAUSED" : "OK"} />
          <Stat label="Comments today" value={health?.commentsToday ?? 0} />
          <Stat label="Errors / rate limits" value={`${health?.errors ?? 0} / ${health?.rateLimitHits ?? 0}`} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Funnel">
          <Funnel steps={funnel} />
        </Card>
        <Card title="Recent events">
          <ul className="divide-y divide-zinc-100">
            {recentEvents.map((e) => (
              <li key={e.id} className="flex justify-between gap-3 py-1.5">
                <span className="font-medium">{e.type}</span>
                <span className="text-[11px] text-zinc-400">{e.createdAt.toISOString().replace("T", " ").slice(0, 19)}</span>
              </li>
            ))}
            {recentEvents.length === 0 && <li className="py-2 text-zinc-400">No events yet.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
