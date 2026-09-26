import Link from "next/link";
import type { Prisma, SpeaksAbout } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SPEAKS_ABOUT_LABELS, scoreGate, effective, isCounted } from "@/lib/voices/review";
import { MIN_VOICE_WORDS } from "@/lib/voices/split";
import { STRUGGLE_LABELS } from "@/lib/insights/taxonomy";
import { parseEvidence, quoteAppears } from "@/lib/insights/evidence";
import { scoreLabels, isStruggleTag } from "@/lib/insights/labelReview";
import { Verdict } from "./Verdict";
import { Labels, IntentReview } from "./Labels";

export const dynamic = "force-dynamic";

const PAGE = 40;
const LABEL_PAGE = 20;
const SHOW = ["todo", "disagree", "reviewed", "all"] as const;
type Show = (typeof SHOW)[number];
const SHOW_LABEL: Record<Show, string> = { todo: "Not yet checked by you", disagree: "You and the model disagree", reviewed: "Checked by you", all: "Everything" };
const LABEL_SHOW = ["todo", "reviewed", "nolabels", "all"] as const;
type LabelShow = (typeof LABEL_SHOW)[number];
const LABEL_SHOW_LABEL: Record<LabelShow, string> = { todo: "Labels you haven't judged", reviewed: "Judged by you", nolabels: "Engine found nothing", all: "Everything" };
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

const pill = (active: boolean) =>
  `rounded-full border px-2.5 py-1 text-[12px] ${active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"}`;

const REAL: Prisma.ConversationWhereInput = { source: { not: "MOCK" }, lead: { isMock: false } };

export default async function AuditPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const focus = searchParams.focus === "people" ? "people" : "labels";
  const sub = searchParams.subreddit;
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const subredditRows = await prisma.conversation.groupBy({ by: ["subreddit"], where: REAL });
  const subreddits = subredditRows.map((r) => r.subreddit).sort();

  const tabs = (
    <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-2">
      <Link href="/audit" className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${focus === "labels" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
        1 · What they struggle with
      </Link>
      <Link href="/audit?focus=people" className={`rounded-md px-3 py-1.5 text-[13px] font-medium ${focus === "people" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>
        2 · Who counts as a person
      </Link>
    </div>
  );

  if (focus === "labels") {
    const show: LabelShow = (LABEL_SHOW as readonly string[]).includes(searchParams.show ?? "") ? (searchParams.show as LabelShow) : "todo";
    const convosRaw = await prisma.conversation.findMany({
      where: { ...REAL, ...(sub ? { subreddit: sub } : {}) },
      select: {
        id: true,
        title: true,
        subreddit: true,
        redditUrl: true,
        lastActivityAt: true,
        struggleEvidence: true,
        analysisProvider: true,
        problemTheme: true,
        unmetNeed: true,
        lead: { select: { intent: true, treatment: true, hairConcern: true } },
        struggleReviews: { select: { tag: true, verdict: true, shouldBe: true, note: true, quote: true } },
        intentReview: { select: { intent: true } },
        messages: { where: { direction: "INBOUND" }, select: { author: true, content: true, postedAt: true, isOriginalPost: true }, orderBy: { postedAt: "asc" } },
      },
      orderBy: { lastActivityAt: "desc" },
    });

    const convos = convosRaw.map((c) => {
      const op = c.messages.find((m) => m.isOriginalPost);
      const opMsgs = op ? c.messages.filter((m) => m.author === op.author) : [];
      const opText = opMsgs.map((m) => m.content).join("\n");
      const byTag = new Map(c.struggleReviews.map((r) => [r.tag, r]));
      const labels = parseEvidence(c.struggleEvidence)
        .filter((e) => isStruggleTag(e.tag))
        .map((e) => {
          const r = byTag.get(e.tag);
          return { tag: e.tag, quote: e.quote, verdict: r?.verdict ?? null, shouldBe: r?.shouldBe ?? null, note: r?.note ?? "", fromOp: e.quote ? quoteAppears(e.quote, opText) : false };
        });
      // Labels a human confirmed stay visible even when a later engine run dropped them.
      for (const r of c.struggleReviews) {
        if (r.verdict !== "RIGHT" || !isStruggleTag(r.tag) || labels.some((l) => l.tag === r.tag)) continue;
        labels.push({ tag: r.tag, quote: r.quote, verdict: r.verdict, shouldBe: null, note: r.note, fromOp: r.quote ? quoteAppears(r.quote, opText) : false });
      }
      const missed = c.struggleReviews.filter((r) => r.verdict === "MISSED").map((r) => r.tag).filter(isStruggleTag);
      // A Wrong label without "what it should be" is still an open question.
      const unjudged = labels.filter((l) => !l.verdict || (l.verdict === "WRONG" && !l.shouldBe)).length;
      return { ...c, op, opMsgs, labels, missed, unjudged };
    });

    const allReviews = convos.flatMap((c) => c.struggleReviews);
    const score = scoreLabels(allReviews);
    const totalLabels = convos.reduce((n, c) => n + c.labels.length, 0);
    const heuristicLabels = convos.filter((c) => c.analysisProvider === "heuristic").reduce((n, c) => n + c.labels.length, 0);
    const notFromOp = convos.reduce((n, c) => n + c.labels.filter((l) => !l.fromOp).length, 0);
    const unjudged = convos.reduce((n, c) => n + c.unjudged, 0);

    const filtered = convos.filter((c) =>
      show === "todo" ? c.unjudged > 0 : show === "reviewed" ? c.struggleReviews.length > 0 : show === "nolabels" ? c.labels.length === 0 : true,
    );
    const pages = Math.max(1, Math.ceil(filtered.length / LABEL_PAGE));
    const rows = filtered.slice((page - 1) * LABEL_PAGE, page * LABEL_PAGE);

    const qs = (patch: Record<string, string | undefined>) => {
      const p = new URLSearchParams();
      const merged = { show: show === "todo" ? undefined : show, subreddit: sub, ...patch };
      for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
      const s = p.toString();
      return `/audit${s ? `?${s}` : ""}`;
    };

    return (
      <div className="space-y-4">
        <header className="max-w-3xl">
          <h1 className="text-lg font-semibold">Audit the engine</h1>
          <p className="text-[13px] text-zinc-500">
            These are the exact labels behind the percentages on Insights. For every thread you see the person&apos;s own words, the struggle label the engine gave, and the
            sentence it used as proof. Judge each label <b>Right</b> or <b>Wrong</b> — and when it&apos;s wrong, say <b>what it should be</b> (another struggle, or none) — add anything
            it <b>missed</b>, and correct the <b>intent</b> if you read the person differently.
          </p>
          <details className="mt-1 text-[12px] text-zinc-500">
            <summary className="cursor-pointer select-none font-medium text-zinc-700">What happens with every verdict you give</summary>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">
              <li><b>Insights changes now.</b> Wrong → the label leaves the counts; “should be X” → X is counted with the same quote; missed → added; a corrected intent replaces the engine&apos;s. Insights marks these human-confirmed / corrected / added.</li>
              <li><b>The engine&apos;s answer is kept</b> next to yours (its label, quote and whether it was Claude or keyword rules), so the score below is always engine vs. you.</li>
              <li><b>Golden set.</b> The next classifier version is scored against your decisions (precision per label, and which labels it confuses) before it is allowed to replace the current one.</li>
              <li><b>Worked examples.</b> Every “wrong → should be X” with its quote and your note is fed into the classifier prompt as a mistake to avoid.</li>
            </ol>
          </details>
        </header>
        {tabs}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card p-3">
            <div className="text-[11px] uppercase tracking-wide text-zinc-400">Labels the engine gave</div>
            <div className="text-2xl font-semibold tabular-nums">{totalLabels}</div>
            <div className="text-[12px] text-zinc-500">on {convos.filter((c) => c.labels.length).length} of {convos.length} threads · {unjudged} not judged yet</div>
          </div>
          <div className="card p-3" title="Of the engine's labels you judged, the share you agreed with.">
            <div className="text-[11px] uppercase tracking-wide text-zinc-400">Labels you agreed with</div>
            <div className="text-2xl font-semibold tabular-nums">{pct(score.precision)}</div>
            <div className="text-[12px] text-zinc-500">{score.right} right · {score.wrong} wrong ({score.corrected} re-labelled) · {score.missed} missed by the engine</div>
          </div>
          <div className="card p-3" title="Labels produced by keyword rules while the model was unavailable. These are the weakest and the most worth checking.">
            <div className="text-[11px] uppercase tracking-wide text-zinc-400">From keyword rules, not a model</div>
            <div className="text-2xl font-semibold tabular-nums">{heuristicLabels}</div>
            <div className="text-[12px] text-zinc-500">{totalLabels - heuristicLabels} labelled by Claude before credits ran out</div>
          </div>
          <div className="card p-3" title="The proof sentence was not found in the original poster's own words — it came from a commenter or is missing. Such a label says nothing about the poster.">
            <div className="text-[11px] uppercase tracking-wide text-zinc-400">Proof not in the poster&apos;s words</div>
            <div className={`text-2xl font-semibold tabular-nums ${notFromOp ? "text-red-700" : ""}`}>{notFromOp}</div>
            <div className="text-[12px] text-zinc-500">flagged in red on the card — usually wrong</div>
          </div>
        </div>

        {score.perTag.length > 0 && (
          <div className="card p-3 text-[12px] text-zinc-600">
            <span className="font-medium text-zinc-800">Per label: </span>
            {score.perTag.slice(0, 8).map((t, i) => (
              <span key={t.tag}>
                {i > 0 && " · "}
                <b>{isStruggleTag(t.tag) ? STRUGGLE_LABELS[t.tag] : t.tag}</b> {t.right} right / {t.wrong} wrong{t.missed ? ` / ${t.missed} missed` : ""}
                {Object.keys(t.shouldBe).length > 0 && (
                  <span className="text-zinc-400">
                    {" "}(really: {Object.entries(t.shouldBe).map(([k, n]) => `${k === "NONE" ? "no struggle" : isStruggleTag(k) ? STRUGGLE_LABELS[k] : k} ×${n}`).join(", ")})
                  </span>
                )}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {LABEL_SHOW.map((s) => (
            <Link key={s} href={qs({ show: s, page: undefined })} className={pill(show === s)}>{LABEL_SHOW_LABEL[s]}</Link>
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

        <p className="text-[12px] text-zinc-500">Showing {rows.length} of {filtered.length} threads. Labels today are per thread (the original poster); per-commenter labels arrive with the model run.</p>

        <div className="space-y-4">
          {rows.map((c) => (
            <section key={c.id} className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-2">
                <div className="min-w-0">
                  <Link href={`/conversations/${c.id}`} className="font-medium text-zinc-900 hover:underline">{c.title || "(untitled)"}</Link>
                  <span className="ml-2 text-[12px] text-zinc-400">r/{c.subreddit} · {fmt(c.lastActivityAt)}</span>
                </div>
                <a href={c.redditUrl} target="_blank" rel="noreferrer" className="text-[12px] text-zinc-500 underline-offset-2 hover:underline">Open on Reddit ↗</a>
              </div>
              <div className="grid gap-3 px-3 py-3 lg:grid-cols-[minmax(0,1fr)_380px]">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Original poster</span>
                    <span className="font-medium text-zinc-800">u/{c.op?.author ?? "?"}</span>
                    <span className="text-zinc-400">{c.opMsgs.length} {c.opMsgs.length === 1 ? "message" : "messages"} · {c.messages.length - c.opMsgs.length} comments by others (not shown)</span>
                  </div>
                  <div className="space-y-2">
                    {c.opMsgs.map((m, i) => (
                      <blockquote key={i} className="whitespace-pre-wrap break-words rounded-md border-l-2 border-zinc-200 bg-white pl-3 text-[13px] leading-relaxed text-zinc-800">
                        <span className="mr-1 text-[10px] uppercase tracking-wide text-zinc-400">{m.isOriginalPost ? "post" : "their comment"} · {fmt(m.postedAt)}</span>
                        {m.content}
                      </blockquote>
                    ))}
                    {c.opMsgs.length === 0 && <p className="text-[12px] text-zinc-400">No text stored for the original poster.</p>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-zinc-500">
                    <span className="uppercase tracking-wide text-zinc-400">Engine&apos;s read: </span>
                    {c.problemTheme && <span>problem “{c.problemTheme}” ·</span>}
                    {c.lead.treatment && <span>on {c.lead.treatment} ·</span>}
                    <IntentReview conversationId={c.id} engine={c.lead.intent} human={c.intentReview?.intent ?? null} />
                  </div>
                </div>
                <div className="text-[12px]">
                  {c.labels.some((l) => !l.fromOp) && (
                    <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
                      {c.labels.filter((l) => !l.fromOp).length === 1 ? "One label's proof" : "Some labels' proof"} is not in the poster&apos;s own words (from a commenter, or missing) — it does not describe this person.
                    </p>
                  )}
                  <Labels
                    conversationId={c.id}
                    provider={c.analysisProvider ?? ""}
                    labels={c.labels.map(({ tag, quote, verdict, shouldBe, note }) => ({ tag, quote, verdict, shouldBe, note }))}
                    missed={c.missed}
                  />
                </div>
              </div>
            </section>
          ))}
          {rows.length === 0 && <div className="card px-3 py-8 text-center text-[13px] text-zinc-400">Nothing here{show === "todo" ? " — you have judged every label." : "."}</div>}
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

  const show: Show = (SHOW as readonly string[]).includes(searchParams.show ?? "") ? (searchParams.show as Show) : "todo";
  const role = searchParams.role === "OP" || searchParams.role === "COMMENTER" ? searchParams.role : undefined;
  const model = MODEL_FILTERS.includes(searchParams.model as SpeaksAbout | "PENDING") ? (searchParams.model as SpeaksAbout | "PENDING") : undefined;

  const base: Prisma.VoiceWhereInput = {
    conversation: { ...REAL, ...(sub ? { subreddit: sub } : {}) },
    ...(role ? { role } : {}),
    ...(model === "PENDING" ? { gatedAt: null } : model ? { speaksAbout: model, gatedAt: { not: null } } : {}),
  };
  const where: Prisma.VoiceWhereInput = {
    ...base,
    ...(show === "todo" ? { review: null } : show === "reviewed" || show === "disagree" ? { review: { isNot: null } } : {}),
  };

  const [voicesRaw, total, reviewedRows, todoCount, pendingModel] = await Promise.all([
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
    const p = new URLSearchParams({ focus: "people" });
    const merged = { show: show === "todo" ? undefined : show, role, model, subreddit: sub, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/audit?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <header className="max-w-3xl">
        <h1 className="text-lg font-semibold">Audit the engine</h1>
        <p className="text-[13px] text-zinc-500">
          Before a struggle can be counted, the engine must decide whether the writer is describing <b>their own case</b> — advice to the poster, a story about a
          relative, sellers and off-topic chatter must not enter the population numbers. Every person in every thread is listed here with their exact words; tap your verdict.
          Yours overrides the model in Insights and becomes its test set.
        </p>
      </header>
      {tabs}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-zinc-400">People read</div>
          <div className="text-2xl font-semibold tabular-nums">{total}</div>
          <div className="text-[12px] text-zinc-500">{pendingModel} not yet judged by the model (no credits)</div>
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
                        <div className="text-[10px] uppercase tracking-wide text-zinc-400">Is this their own case? Engine says</div>
                        {modelDecided && v.speaksAbout ? (
                          <div>
                            <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${CHIP[v.speaksAbout]}`}>{SPEAKS_ABOUT_LABELS[v.speaksAbout].label}</span>
                            {v.speaksAbout === "OWN_CASE" && v.inScope === false && <span className="ml-1 text-zinc-500">not hair/scalp</span>}
                            {v.minor && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-700">minor</span>}
                            <span className="ml-1 text-[10px] text-zinc-400">{v.gateProvider === "prefilter" ? "rule" : "model"}</span>
                            <p className="mt-1 text-zinc-600">{v.gateWhy}</p>
                          </div>
                        ) : (
                          <p className="text-zinc-500">Not judged yet{v.gateWhy ? ` — ${v.gateWhy}` : " — the model has no credits"}. Counts only if you say so.</p>
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
