import Link from "next/link";
import type { Prisma, SpeaksAbout } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SPEAKS_ABOUT_LABELS, scoreGate, effective, isCounted } from "@/lib/voices/review";
import { MIN_VOICE_WORDS } from "@/lib/voices/split";
import { Verdict } from "./Verdict";

export const dynamic = "force-dynamic";

const PAGE = 40;
const SHOW = ["todo", "disagree", "reviewed", "all"] as const;
type Show = (typeof SHOW)[number];
const SHOW_LABEL: Record<Show, string> = { todo: "Not yet checked by you", disagree: "You and the model disagree", reviewed: "Checked by you", all: "Everything" };
const MODEL_FILTERS: (SpeaksAbout | "PENDING")[] = ["OWN_CASE", "ADVICE_ONLY", "SOMEONE_ELSE", "VENDOR", "META", "UNCLEAR", "PENDING"];

const CHIP: Record<SpeaksAbout, string> = {
  OWN_CASE: "bg-emerald-100 text-emerald-800",
  ADVICE_ONLY: "bg-sky-100 text-sky-700",
  SOMEONE_ELSE: "bg-violet-100 text-violet-700",
  VENDOR: "bg-orange-100 text-orange-700",
  META: "bg-zinc-100 text-zinc-500",
  UNCLEAR: "bg-amber-100 text-amber-800",
};

function pct(n: number | null) {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

function fmt(d: Date) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default async function AuditPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const show: Show = (SHOW as readonly string[]).includes(searchParams.show ?? "") ? (searchParams.show as Show) : "todo";
  const role = searchParams.role === "OP" || searchParams.role === "COMMENTER" ? searchParams.role : undefined;
  const model = MODEL_FILTERS.includes(searchParams.model as SpeaksAbout | "PENDING") ? (searchParams.model as SpeaksAbout | "PENDING") : undefined;
  const sub = searchParams.subreddit;
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);

  const base: Prisma.VoiceWhereInput = {
    conversation: { source: { not: "MOCK" }, lead: { isMock: false }, ...(sub ? { subreddit: sub } : {}) },
    ...(role ? { role } : {}),
    ...(model === "PENDING" ? { gatedAt: null } : model ? { speaksAbout: model, gatedAt: { not: null } } : {}),
  };
  const where: Prisma.VoiceWhereInput = {
    ...base,
    ...(show === "todo" ? { review: null } : show === "reviewed" || show === "disagree" ? { review: { isNot: null } } : {}),
  };

  const [voicesRaw, total, reviewedRows, todoCount, pendingModel, subredditRows] = await Promise.all([
    prisma.voice.findMany({
      where,
      include: { review: true, conversation: { select: { id: true, title: true, subreddit: true, redditUrl: true, lastActivityAt: true } } },
      orderBy: [{ conversation: { lastActivityAt: "desc" } }, { role: "asc" }, { createdAt: "asc" }],
      // "disagree" is decided in memory, so over-fetch and trim below.
      take: show === "disagree" ? 2000 : PAGE,
      skip: show === "disagree" ? 0 : (page - 1) * PAGE,
    }),
    prisma.voice.count({ where: base }),
    prisma.voiceReview.findMany({
      where: { voice: base },
      select: { speaksAbout: true, inScope: true, modelSpeaksAbout: true, modelInScope: true },
    }),
    prisma.voice.count({ where: { ...base, review: null } }),
    prisma.voice.count({ where: { ...base, gatedAt: null } }),
    prisma.conversation.groupBy({ by: ["subreddit"], where: { source: { not: "MOCK" }, lead: { isMock: false } } }),
  ]);

  const disagreeAll = show === "disagree" ? voicesRaw.filter((v) => v.review && v.review.modelSpeaksAbout && v.review.modelSpeaksAbout !== v.review.speaksAbout) : voicesRaw;
  const voices = show === "disagree" ? disagreeAll.slice((page - 1) * PAGE, page * PAGE) : voicesRaw;
  const listTotal = show === "disagree" ? disagreeAll.length : show === "todo" ? todoCount : show === "reviewed" ? reviewedRows.length : total;
  const pages = Math.max(1, Math.ceil(listTotal / PAGE));

  const messageIds = voices.flatMap((v) => v.messageIds);
  const messages = messageIds.length
    ? await prisma.message.findMany({ where: { id: { in: messageIds } }, select: { id: true, content: true, postedAt: true, isOriginalPost: true } })
    : [];
  const msgById = new Map(messages.map((m) => [m.id, m]));

  const score = scoreGate(reviewedRows);
  const groups: { conv: (typeof voices)[number]["conversation"]; voices: typeof voices }[] = [];
  for (const v of voices) {
    const g = groups[groups.length - 1];
    if (g && g.conv.id === v.conversationId) g.voices.push(v);
    else groups.push({ conv: v.conversation, voices: [v] });
  }

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { show: show === "todo" ? undefined : show, role, model, subreddit: sub, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/audit${s ? `?${s}` : ""}`;
  };
  const pill = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-[12px] ${active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"}`;
  const subreddits = subredditRows.map((r) => r.subreddit).sort();

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-lg font-semibold">Audit the engine</h1>
          <p className="text-[13px] text-zinc-500">
            Every person the engine read — the original poster and each commenter — with exactly what they wrote and what the engine decided about them.
            Read it yourself and tap your verdict. Your verdict overrides the model in Insights and becomes the test set every new classifier version has to pass.
          </p>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-zinc-400">People read</div>
          <div className="text-2xl font-semibold tabular-nums">{total}</div>
          <div className="text-[12px] text-zinc-500">{pendingModel} still waiting for the model</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-zinc-400">Checked by you</div>
          <div className="text-2xl font-semibold tabular-nums">{score.reviewed}</div>
          <div className="text-[12px] text-zinc-500">{todoCount} left to check</div>
        </div>
        <div className="card p-3" title="On the people you checked where the model had also decided: how often it picked the same category as you.">
          <div className="text-[11px] uppercase tracking-wide text-zinc-400">Model agrees with you</div>
          <div className="text-2xl font-semibold tabular-nums">{pct(score.accuracy)}</div>
          <div className="text-[12px] text-zinc-500">{score.agree} of {score.compared} compared</div>
        </div>
        <div className="card p-3" title="Of the people the model counted as 'own case', how many you also counted (precision) — and of the people you counted, how many the model caught (recall).">
          <div className="text-[11px] uppercase tracking-wide text-zinc-400">“Counts as a person”</div>
          <div className="text-2xl font-semibold tabular-nums">
            {pct(score.counted.precision)} <span className="text-[13px] font-normal text-zinc-400">precise</span>
          </div>
          <div className="text-[12px] text-zinc-500">
            {pct(score.counted.recall)} caught · {score.counted.fp} wrongly counted · {score.counted.fn} missed
          </div>
        </div>
      </div>

      {score.confusions.length > 0 && (
        <div className="card p-3 text-[12px] text-zinc-600">
          <span className="font-medium text-zinc-800">Where the model gets it wrong: </span>
          {score.confusions.slice(0, 5).map((c, i) => (
            <span key={i}>
              {i > 0 && " · "}
              said <b>{SPEAKS_ABOUT_LABELS[c.model].label}</b>, was <b>{SPEAKS_ABOUT_LABELS[c.human].label}</b> ×{c.count}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {SHOW.map((s) => (
          <Link key={s} href={qs({ show: s, page: undefined })} className={pill(show === s)}>{SHOW_LABEL[s]}</Link>
        ))}
        <span className="mx-1 text-zinc-300">|</span>
        <Link href={qs({ role: role === "OP" ? undefined : "OP", page: undefined })} className={pill(role === "OP")}>Original posters</Link>
        <Link href={qs({ role: role === "COMMENTER" ? undefined : "COMMENTER", page: undefined })} className={pill(role === "COMMENTER")}>Commenters</Link>
        <span className="mx-1 text-zinc-300">|</span>
        {MODEL_FILTERS.map((m) => (
          <Link key={m} href={qs({ model: model === m ? undefined : m, page: undefined })} className={pill(model === m)} title={m === "PENDING" ? "The model has not decided yet." : SPEAKS_ABOUT_LABELS[m].hint}>
            model: {m === "PENDING" ? "undecided" : SPEAKS_ABOUT_LABELS[m].label}
          </Link>
        ))}
        {subreddits.length > 1 && (
          <>
            <span className="mx-1 text-zinc-300">|</span>
            {subreddits.map((s) => (
              <Link key={s} href={qs({ subreddit: sub === s ? undefined : s, page: undefined })} className={pill(sub === s)}>r/{s}</Link>
            ))}
          </>
        )}
      </div>

      <p className="text-[12px] text-zinc-500">
        Showing {voices.length} of {listTotal}. Rules that never reach the model: bots and deleted accounts are off-topic; fewer than {MIN_VOICE_WORDS} words is unclear.
      </p>

      <div className="space-y-4">
        {groups.map(({ conv, voices: vs }) => (
          <section key={conv.id} className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-2">
              <div className="min-w-0">
                <Link href={`/conversations/${conv.id}`} className="font-medium text-zinc-900 hover:underline">{conv.title || "(untitled)"}</Link>
                <span className="ml-2 text-[12px] text-zinc-400">r/{conv.subreddit} · {fmt(conv.lastActivityAt)}</span>
              </div>
              <a href={conv.redditUrl} target="_blank" rel="noreferrer" className="text-[12px] text-zinc-500 underline-offset-2 hover:underline">Open on Reddit ↗</a>
            </div>
            <ul className="divide-y divide-zinc-100">
              {vs.map((v) => {
                const eff = effective(v);
                const modelDecided = v.gatedAt !== null && v.speaksAbout !== null;
                const msgs = v.messageIds.map((id) => msgById.get(id)).filter((m): m is NonNullable<typeof m> => Boolean(m)).sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
                return (
                  <li key={v.id} className="grid gap-3 px-3 py-3 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px]">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${v.role === "OP" ? "bg-zinc-900 text-white" : "bg-zinc-200 text-zinc-700"}`}>{v.role === "OP" ? "Original poster" : "Commenter"}</span>
                        <span className="font-medium text-zinc-800">u/{v.author}</span>
                        <span className="text-zinc-400">{v.wordCount} words · {msgs.length} {msgs.length === 1 ? "message" : "messages"}</span>
                      </div>
                      <div className="space-y-2">
                        {msgs.map((m) => (
                          <blockquote key={m.id} className="whitespace-pre-wrap break-words rounded-md border-l-2 border-zinc-200 bg-white pl-3 text-[13px] leading-relaxed text-zinc-800">
                            <span className="mr-1 text-[10px] uppercase tracking-wide text-zinc-400">{m.isOriginalPost ? "post" : "comment"} · {fmt(m.postedAt)}</span>
                            {m.content}
                          </blockquote>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2 text-[12px]">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-zinc-400">Engine says</div>
                        {modelDecided && v.speaksAbout ? (
                          <div>
                            <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${CHIP[v.speaksAbout]}`}>{SPEAKS_ABOUT_LABELS[v.speaksAbout].label}</span>
                            {v.speaksAbout === "OWN_CASE" && v.inScope === false && <span className="ml-1 text-zinc-500">not hair/scalp</span>}
                            {v.minor && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-700">minor</span>}
                            <span className="ml-1 text-[10px] text-zinc-400">{v.gateProvider === "prefilter" ? "rule" : "model"}</span>
                            <p className="mt-1 text-zinc-600">{v.gateWhy}</p>
                          </div>
                        ) : (
                          <p className="text-zinc-500">Not decided yet{v.gateWhy ? ` — ${v.gateWhy}` : ""}. Counts only if you say so.</p>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-zinc-400">You say</div>
                        <Verdict
                          voiceId={v.id}
                          human={v.review ? { speaksAbout: v.review.speaksAbout, inScope: v.review.inScope } : null}
                          model={modelDecided && v.speaksAbout ? { speaksAbout: v.speaksAbout, inScope: v.inScope } : null}
                        />
                      </div>
                      <div className={`text-[11px] ${isCounted(eff) ? "text-emerald-700" : "text-zinc-400"}`}>
                        {isCounted(eff) ? "Counted as a person in Insights" : "Not counted in Insights"}
                        {eff.source === "human" && " (your call)"}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {voices.length === 0 && <div className="card px-3 py-8 text-center text-[13px] text-zinc-400">Nothing here{show === "todo" ? " — you have checked everyone that matches." : "."}</div>}
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-[12px] text-zinc-500">
          <span>Page {page} of {pages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={qs({ page: String(page - 1) })} className={pill(false)}>← Previous</Link>}
            {page < pages && <Link href={qs({ page: String(page + 1) })} className={pill(false)}>Next →</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
