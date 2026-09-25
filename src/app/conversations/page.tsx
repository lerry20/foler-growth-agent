import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ConversationsPage() {
  const conversations = await prisma.conversation.findMany({
    orderBy: { lastActivityAt: "desc" },
    include: {
      lead: true,
      actions: { where: { status: { in: ["PROPOSED", "APPROVAL_REQUESTED", "MANUAL_REQUIRED", "APPROVED"] } }, take: 1, orderBy: { createdAt: "desc" } },
    },
  });
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Conversations</h1>
      <table className="w-full border-collapse rounded-lg border border-zinc-200 bg-white text-[12px]">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-400">
            {["Title", "Person", "Subreddit", "Stage", "Permission", "Pending action", "Last activity"].map((h) => (
              <th key={h} className="px-3 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {conversations.map((c) => (
            <tr key={c.id} className="border-b border-zinc-100 hover:bg-zinc-50">
              <td className="max-w-64 truncate px-3 py-2">
                <Link href={`/conversations/${c.id}`} className="font-medium text-zinc-800 hover:underline">
                  {c.title || c.redditUrl}
                </Link>
              </td>
              <td className="px-3 py-2">u/{c.lead.redditUsername}</td>
              <td className="px-3 py-2">r/{c.subreddit}</td>
              <td className="px-3 py-2">{c.stage}</td>
              <td className="px-3 py-2">{c.permissionState}</td>
              <td className="px-3 py-2">{c.actions[0] ? `${c.actions[0].type} (${c.actions[0].status})` : "—"}</td>
              <td className="px-3 py-2 text-zinc-400">{c.lastActivityAt.toISOString().slice(0, 16).replace("T", " ")}</td>
            </tr>
          ))}
          {conversations.length === 0 && (
            <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-400">No conversations yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
