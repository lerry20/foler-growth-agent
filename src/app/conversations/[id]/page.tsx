import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { Card } from "@/components/Funnel";
import { ActionButton, ActionForm, CopyButton, SubmitButton } from "@/components/buttons";
import { BTN } from "@/components/btn";
import type { AnalysisResult } from "@/lib/ai/types";
import type { ScoreBreakdown } from "@/lib/scoring";
import {
  approveActionForm, rejectActionForm, snoozeActionForm, markPostedForm,
  generateActionForm, reanalyzeForm, refreshConversationForm, importReplyForm,
} from "@/app/actions";
import { EditApprove } from "./EditAction";
import { ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

const BOT_AUTHORS = new Set(["AutoModerator"]);
const LONG = 220;

function fmt(d: Date) {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function cleanPost(s: string) {
  return s.replace(/\s*submitted by\s+\/u\/\S+\s*(\[link\]\s*)?(\[comments\])?\s*$/i, "").trim();
}

function pretty(s: string) {
  return s.toLowerCase().replace(/_/g, " ");
}

/** Splits "[gated: X → Y] rest" into a gate label and body, and body into first sentence + remainder. */
function splitReason(reason: string) {
  const m = reason.match(/^\s*\[([^\]]+)\]\s*([\s\S]*)$/);
  const gate = m ? m[1] : null;
  const body = (m ? m[2] : reason).trim();
  const m2 = /[.!?]\s+(?=[A-Z])/.exec(body);
  const cut = m2 ? m2.index + 1 : -1;
  const first = cut > 0 ? body.slice(0, cut) : body;
  const rest = cut > 0 ? body.slice(cut).trim() : "";
  return { gate, first, rest };
}

function Clamp({ text, limit = LONG, className = "" }: { text: string; limit?: number; className?: string }) {
  if (text.length <= limit) return <div className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed ${className}`}>{text}</div>;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className={`group-open:hidden leading-relaxed ${className}`}>{text.slice(0, limit).trimEnd()}… <span className="text-[12px] text-zinc-400">show more</span></div>
      </summary>
      <div className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed ${className}`}>{text}</div>
    </details>
  );
}

function Chip({ children, tone = "zinc" }: { children: React.ReactNode; tone?: "zinc" | "green" | "amber" | "red" }) {
  const tones = {
    zinc: "bg-zinc-100 text-zinc-600",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-700",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-[12px]">
      <span className="w-36 text-zinc-500">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-zinc-100">
        <div className="h-1.5 rounded-full bg-zinc-400" style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <span className="w-6 text-right tabular-nums text-zinc-500">{value}</span>
    </div>
  );
}

function Fold({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer select-none list-none text-[12px] text-zinc-500 hover:text-zinc-800 [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">▸ </span><span className="hidden group-open:inline">▾ </span>{summary}
      </summary>
      <div className="pt-2">{children}</div>
    </details>
  );
}

function Message({ author, at, content, outbound, muted }: { author: string; at: Date; content: string; outbound: boolean; muted: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${outbound ? "border-emerald-200 bg-emerald-50/60" : "border-zinc-200"}`}>
      <div className="mb-1 flex items-center gap-2 text-[11px] text-zinc-400">
        <span className={outbound ? "font-medium text-emerald-700" : "font-medium text-zinc-600"}>u/{author}</span>
        <span>{fmt(at)}</span>
        {outbound && <Chip tone="green">you</Chip>}
        {muted && <Chip>bot</Chip>}
      </div>
      {muted ? (
        <Fold summary="Show moderator message"><Clamp text={content} /></Fold>
      ) : <Clamp text={content} className="text-zinc-700" />}
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
  const replies = c.messages.filter((m) => !m.isOriginalPost);
  const catTone = lead.category === "HOT" ? "red" : lead.category === "WARM" ? "amber" : "zinc";

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="max-w-full truncate text-lg font-semibold tracking-tight md:max-w-2xl md:text-xl">{c.title}</h1>
          <a href={c.redditUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-zinc-500 hover:underline">
            Open on Reddit <ExternalLink size={12} />
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-zinc-600">
          <a className="font-medium text-zinc-900 hover:underline" href={lead.profileUrl} target="_blank" rel="noreferrer">u/{lead.redditUsername}</a>
          <span className="text-zinc-300">·</span>
          <span>r/{c.subreddit}</span>
          {lead.isMock && <Chip tone="amber">mock</Chip>}
          <Chip tone={catTone}>score {lead.leadScore} · {lead.category.toLowerCase()}</Chip>
          <Chip>{pretty(c.stage)}</Chip>
          {c.permissionState !== "NO_FOLER_MENTION" && <Chip tone="green">{pretty(c.permissionState)}</Chip>}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-5 min-w-0">
          {(pending || analysis) && (
            pending && pending.status === "MANUAL_REQUIRED" ? (
              <Card title="Ready to post — paste this on Reddit">
                <div className="space-y-3">
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 leading-relaxed break-words [overflow-wrap:anywhere]">{pending.finalResponse ?? pending.proposedResponse}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CopyButton text={pending.finalResponse ?? pending.proposedResponse} />
                    <a href={c.redditUrl} target="_blank" rel="noreferrer" className={BTN.ghost}>Open thread</a>
                    <ActionButton label="I posted it" title="Tell the agent the comment is live so it starts watching for replies" action={markPostedForm.bind(null, pending.id)} />
                  </div>
                </div>
              </Card>
            ) : pending ? (
              <Card title="Suggested reply — needs your approval">
                <div className="space-y-3">
                  {pending.errorMessage && (
                    <div className={`rounded p-2 text-[11px] ${pending.errorMessage.startsWith("Preflight:") ? "bg-red-50 text-red-700 font-medium" : "bg-amber-50 text-amber-800"}`}>
                      {pending.errorMessage}
                    </div>
                  )}
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 leading-relaxed break-words [overflow-wrap:anywhere]">{pending.proposedResponse}</div>
                  <div className="flex flex-wrap gap-2">
                    <ActionButton label="Approve" title="Approve as written — you still post it yourself" action={approveActionForm.bind(null, pending.id, undefined)} />
                    <EditApprove actionId={pending.id} initial={pending.proposedResponse} />
                    <ActionButton label="Reject" title="Drop this draft; nothing is posted" action={rejectActionForm.bind(null, pending.id)} className={BTN.ghost} />
                    <ActionButton label="Snooze 24h" title="Hide it for a day" action={snoozeActionForm.bind(null, pending.id)} className={BTN.ghost} />
                  </div>
                </div>
              </Card>
            ) : analysis ? (
              <Card title={analysis.recommended_action === "IGNORE" ? "No reply recommended" : "No draft yet"}>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={analysis.recommended_action === "IGNORE" ? "zinc" : "green"}>{pretty(analysis.recommended_action)}</Chip>
                    {analysis.blocked.map((b, i) => <Chip key={i} tone="red">{b}</Chip>)}
                  </div>
                  {analysis.suggested_response && (
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 leading-relaxed break-words [overflow-wrap:anywhere]">{analysis.suggested_response}</div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <ActionButton label="Draft a reply" title="Claude writes a reply for you to approve" action={generateActionForm.bind(null, c.id)} />
                  </div>
                </div>
              </Card>
            ) : null
          )}

          <Card title={`Thread · ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}>
            <div className="space-y-2">
              {post && (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <div className="mb-1 text-[11px] text-zinc-400"><span className="font-medium text-zinc-600">u/{post.author}</span> · {fmt(post.postedAt)} · original post</div>
                  <Clamp text={cleanPost(post.content)} />
                </div>
              )}
              {replies.slice(0, 3).map((m) => (
                <Message key={m.id} author={m.author} at={m.postedAt} content={m.content} outbound={m.direction === "OUTBOUND"} muted={BOT_AUTHORS.has(m.author)} />
              ))}
              {replies.length > 3 && (
                <Fold summary={`Show ${replies.length - 3} more ${replies.length - 3 === 1 ? "reply" : "replies"}`}>
                  <div className="space-y-2">
                    {replies.slice(3).map((m) => (
                      <Message key={m.id} author={m.author} at={m.postedAt} content={m.content} outbound={m.direction === "OUTBOUND"} muted={BOT_AUTHORS.has(m.author)} />
                    ))}
                  </div>
                </Fold>
              )}
              {replies.length === 0 && <div className="text-[12px] text-zinc-400">No replies yet.</div>}
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <ActionButton label="Check for new comments" title="Re-read the thread on Reddit" action={refreshConversationForm.bind(null, c.id)} className={BTN.ghost} />
                <Fold summary="Paste a reply by hand">
                  <ActionForm ok="Reply added" action={async (fd: FormData) => { "use server"; await importReplyForm(c.id, fd); }} className="space-y-2">
                    <input name="author" placeholder="Their Reddit username" required className="w-full rounded-md border border-zinc-300 px-2.5 py-1.5" />
                    <textarea name="content" placeholder="Paste their reply" required rows={3} className="w-full rounded-md border border-zinc-300 px-2.5 py-1.5" />
                    <SubmitButton>Add reply</SubmitButton>
                  </ActionForm>
                </Fold>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-5 min-w-0">
          <Card title="About this person">
            <div className="space-y-3 text-[13px]">
              <p className="leading-relaxed text-zinc-800">{lead.problem || "No problem summary yet."}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
                <dt className="text-zinc-400">Intent</dt><dd>{pretty(lead.intent)}</dd>
                <dt className="text-zinc-400">Treatment</dt><dd>{lead.treatment || "—"}{lead.treatmentDuration && <span className="text-zinc-500"> · {lead.treatmentDuration}</span>}</dd>
                <dt className="text-zinc-400">FOLĒR fit</dt><dd className="tabular-nums">{lead.relevanceScore}/100 · conversion {lead.conversionPotential}/100</dd>
                {lead.accountAgeDays != null && (<><dt className="text-zinc-400">Account</dt><dd>{lead.accountAgeDays}d · {lead.karma ?? "?"} karma</dd></>)}
              </dl>
              {breakdown && (
                <Fold summary="Score breakdown">
                  <Bar label="Problem relevance" value={breakdown.problemRelevance} max={30} />
                  <Bar label="Measurement intent" value={breakdown.measurementIntent} max={25} />
                  <Bar label="Treatment journey" value={breakdown.treatmentJourney} max={15} />
                  <Bar label="Opportunity" value={breakdown.conversationOpportunity} max={15} />
                  <Bar label="Product intent" value={breakdown.productIntent} max={10} />
                  <Bar label="Recency" value={breakdown.recency} max={5} />
                </Fold>
              )}
            </div>
          </Card>

          {analysis ? (
            <Card title="Why the AI suggests this">
              <div className="space-y-2 text-[13px]">
                {(() => {
                  const { gate, first, rest } = splitReason(analysis.reason);
                  return (
                    <>
                      {gate && <Chip tone="amber">{gate}</Chip>}
                      <p className="leading-relaxed text-zinc-700">{first}</p>
                      {rest && <Fold summary="Full reasoning"><p className="leading-relaxed text-zinc-600">{rest}</p></Fold>}
                    </>
                  );
                })()}
                <div className="flex items-center gap-2 pt-1 text-[11px] text-zinc-400">
                  {analysis.provider === "anthropic" ? "Claude analysis" : "heuristic fallback"}
                  <ActionButton label="Analyze again" title="Re-read the whole thread and redo the analysis" action={reanalyzeForm.bind(null, c.id)} className={BTN.ghost} />
                </div>
              </div>
            </Card>
          ) : (
            <Card title="Not analyzed yet">
              <div className="space-y-3">
                <div className="text-[13px] text-zinc-400">Claude hasn&apos;t read this thread yet.</div>
                <ActionButton label="Analyze" title="Read the thread and classify the problem" action={reanalyzeForm.bind(null, c.id)} />
              </div>
            </Card>
          )}

          <Card title="Timeline">
            <Fold summary={`${c.events.length} event${c.events.length === 1 ? "" : "s"}`}>
              <ul className="space-y-1 text-[12px]">
                {c.events.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span className="text-zinc-700">{pretty(e.type)}</span>
                    <span className="text-[11px] text-zinc-400">{fmt(e.createdAt)}</span>
                  </li>
                ))}
                {c.events.length === 0 && <li className="text-zinc-400">No events.</li>}
              </ul>
            </Fold>
          </Card>
        </div>
      </div>
    </div>
  );
}
