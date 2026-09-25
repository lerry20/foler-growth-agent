import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card } from "@/components/Funnel";
import { ActionButton, CopyButton } from "@/components/buttons";
import type { AnalysisResult } from "@/lib/ai/types";
import type { ScoreBreakdown } from "@/lib/scoring";
import {
  approveActionForm, rejectActionForm, snoozeActionForm, markPostedForm,
  generateActionForm, reanalyzeForm, refreshConversationForm, importReplyForm,
} from "@/app/actions";
import { EditApprove } from "./EditAction";
import { ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-36 text-zinc-500">{label}</span>
      <div className="h-2 rounded-sm bg-zinc-200" style={{ width: `${(value / max) * 100}px` }} />
      <span className="tabular-nums text-zinc-600">{value}</span>
    </div>
  );
}

export default async function ConversationPage({ params }: { params: { id: string } }) {
  const c = await prisma.conversation.findUnique({
    where: { id: params.id },
    include: {
      lead: true,
      messages: { orderBy: { postedAt: "asc" } },
      actions: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!c) notFound();
  const lead = c.lead;
  const analysis = c.lastAnalysis as unknown as AnalysisResult | null;
  const breakdown = lead.scoreBreakdown as unknown as ScoreBreakdown | null;
  const pending = c.actions.find((a) => ["PROPOSED", "APPROVAL_REQUESTED", "APPROVED", "MANUAL_REQUIRED"].includes(a.status));
  const post = c.messages.find((m) => m.isOriginalPost);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="max-w-xl truncate text-lg font-semibold">{c.title}</h1>
        <a href={c.redditUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-zinc-500 hover:underline">
          Open on Reddit <ExternalLink size={12} />
        </a>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Person">
          <div className="space-y-1">
            <div><a className="font-medium hover:underline" href={lead.profileUrl} target="_blank" rel="noreferrer">u/{lead.redditUsername}</a> {lead.isMock && <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800">MOCK</span>}</div>
            <div className="text-zinc-500">r/{c.subreddit}</div>
            {lead.accountAgeDays != null && <div className="text-zinc-500">Account: {lead.accountAgeDays}d · {lead.karma ?? "?"} karma</div>}
            <hr className="my-2 border-zinc-100" />
            <div><span className="text-zinc-400">Problem:</span> {lead.problem || "—"}</div>
            <div><span className="text-zinc-400">Treatment:</span> {lead.treatment || "—"} {lead.treatmentDuration && `(${lead.treatmentDuration})`}</div>
            <div><span className="text-zinc-400">Intent:</span> {lead.intent}</div>
            <div><span className="text-zinc-400">Stage:</span> {c.stage}</div>
            <div><span className="text-zinc-400">Permission:</span> {c.permissionState}</div>
            <div><span className="text-zinc-400">FOLĒR relevance:</span> {lead.relevanceScore} · <span className="text-zinc-400">Conversion:</span> {lead.conversionPotential} · <span className="text-zinc-400">Score:</span> {lead.leadScore} ({lead.category})</div>
            {breakdown && (
              <div className="pt-2">
                <div className="pb-1 text-[11px] uppercase tracking-wide text-zinc-400">Score breakdown</div>
                <Bar label="Problem relevance" value={breakdown.problemRelevance} max={30} />
                <Bar label="Measurement intent" value={breakdown.measurementIntent} max={25} />
                <Bar label="Treatment journey" value={breakdown.treatmentJourney} max={15} />
                <Bar label="Opportunity" value={breakdown.conversationOpportunity} max={15} />
                <Bar label="Product intent" value={breakdown.productIntent} max={10} />
                <Bar label="Recency" value={breakdown.recency} max={5} />
              </div>
            )}
          </div>
        </Card>

        <Card title="Thread">
          <div className="space-y-3">
            {post && (
              <div className="rounded border border-zinc-200 bg-zinc-50 p-3">
                <div className="mb-1 text-[11px] text-zinc-400">u/{post.author} · {post.postedAt.toISOString().slice(0, 16).replace("T", " ")} · original post</div>
                <div className="whitespace-pre-wrap">{post.content}</div>
              </div>
            )}
            {c.messages.filter((m) => !m.isOriginalPost).map((m) => (
              <div key={m.id} className={`rounded border p-3 ${m.direction === "OUTBOUND" ? "border-emerald-200 bg-emerald-50" : "border-zinc-200"}`}>
                <div className="mb-1 text-[11px] text-zinc-400">
                  u/{m.author} · {m.postedAt.toISOString().slice(0, 16).replace("T", " ")} · {m.direction.toLowerCase()}
                </div>
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <ActionButton label="Refresh from Reddit" action={refreshConversationForm.bind(null, c.id)} />
            </div>
            <form action={async (fd: FormData) => { "use server"; await importReplyForm(c.id, fd); }} className="space-y-2 rounded border border-zinc-200 p-3">
              <div className="text-[11px] uppercase tracking-wide text-zinc-400">Import reply manually</div>
              <input name="author" placeholder="author" required className="w-full rounded border border-zinc-300 px-2 py-1" />
              <textarea name="content" placeholder="reply text" required rows={3} className="w-full rounded border border-zinc-300 px-2 py-1" />
              <button className="rounded bg-zinc-900 px-3 py-1 text-[12px] text-white">Import reply</button>
            </form>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="AI Copilot">
            {analysis ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                    {analysis.provider === "anthropic" ? "anthropic" : "heuristic fallback"}
                  </span>
                  {analysis.blocked.map((b, i) => (
                    <span key={i} className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">{b}</span>
                  ))}
                </div>
                <div className="text-zinc-600"><span className="text-zinc-400">Recommended:</span> {analysis.recommended_action}</div>
                <div className="text-zinc-600"><span className="text-zinc-400">Reason:</span> {analysis.reason}</div>
                {analysis.suggested_response && (
                  <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-2 italic">“{analysis.suggested_response}”</div>
                )}
              </div>
            ) : (
              <div className="text-zinc-400">Not analyzed yet.</div>
            )}
            <div className="flex gap-2 pt-3">
              <ActionButton label="Generate action" action={generateActionForm.bind(null, c.id)} />
              <ActionButton label="Re-analyze" action={reanalyzeForm.bind(null, c.id)} />
            </div>
          </Card>

          {pending && pending.status === "MANUAL_REQUIRED" ? (
            <Card title="⚠ Manual action required">
              <div className="space-y-2">
                <div className="text-zinc-600">Reddit cannot be posted to via the current provider. Post this reply manually:</div>
                <a href={c.redditUrl} target="_blank" rel="noreferrer" className="block break-all text-zinc-800 underline">{c.redditUrl}</a>
                <textarea readOnly value={pending.finalResponse ?? pending.proposedResponse} rows={4} className="w-full rounded border border-zinc-300 p-2 text-[12px]" />
                <div className="flex items-center gap-2">
                  <CopyButton text={pending.finalResponse ?? pending.proposedResponse} />
                  <ActionButton label="Mark as Posted" action={markPostedForm.bind(null, pending.id)} />
                </div>
              </div>
            </Card>
          ) : pending ? (
            <Card title={`Pending action — ${pending.type} (${pending.status})`}>
              <div className="space-y-2">
                {pending.errorMessage && <div className="rounded bg-amber-50 p-2 text-[11px] text-amber-800">{pending.errorMessage}</div>}
                <div className="rounded border border-zinc-200 bg-zinc-50 p-2 italic">“{pending.proposedResponse}”</div>
                <div className="flex flex-wrap gap-2">
                  <ActionButton label="Approve" action={approveActionForm.bind(null, pending.id, undefined)} />
                  <EditApprove actionId={pending.id} initial={pending.proposedResponse} />
                  <ActionButton label="Reject" action={rejectActionForm.bind(null, pending.id)} className="rounded border border-zinc-300 px-2 py-1 text-[11px] hover:bg-zinc-100" />
                  <ActionButton label="Snooze" action={snoozeActionForm.bind(null, pending.id)} className="rounded border border-zinc-300 px-2 py-1 text-[11px] hover:bg-zinc-100" />
                </div>
              </div>
            </Card>
          ) : null}

          <Card title="Event timeline">
            <ul className="space-y-1 text-[12px]">
              {c.events.map((e) => (
                <li key={e.id} className="flex justify-between gap-2">
                  <span>{e.type}</span>
                  <span className="text-[11px] text-zinc-400">{e.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                </li>
              ))}
              {c.events.length === 0 && <li className="text-zinc-400">No events.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
