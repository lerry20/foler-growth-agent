import { prisma } from "@/lib/db";
import { getKnowledgeBase, getSetting, SETTING_KEYS } from "@/lib/settings";
import { env } from "@/lib/env";
import { getRedditProvider, providerLabel } from "@/lib/reddit";
import { Card } from "@/components/Funnel";
import { ActionButton, ActionForm, SubmitButton } from "@/components/buttons";
import {
  saveSetting, saveSearchCategory, saveCommunity, addCommunity,
  resumeOutboundAction, importRedditUrlForm, pastePostForm, runCycleNowAction,
} from "../actions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const input = "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-[12px]";

export default async function SettingsPage() {
  const [kb, categories, communities, health, provider, redditUser, campaign, useRedirect, waitlistUrl, providerSetting] =
    await Promise.all([
      getKnowledgeBase(),
      prisma.searchCategory.findMany({ orderBy: { key: "asc" } }),
      prisma.communityConfig.findMany({ orderBy: { name: "asc" } }),
      prisma.accountHealth.findUnique({ where: { id: "default" } }),
      getRedditProvider(),
      getSetting(SETTING_KEYS.redditOurUsername, env.REDDIT_OUR_USERNAME),
      getSetting(SETTING_KEYS.attributionCampaign, "reddit-growth-agent"),
      getSetting("attribution.useRedirect", "false"),
      getSetting(SETTING_KEYS.waitlistUrl, ""),
      getSetting(SETTING_KEYS.redditProvider, env.REDDIT_PROVIDER),
    ]);
  const [lastRunAt, lastResultRaw] = await Promise.all([
    getSetting("scheduler.lastRunAt", ""),
    getSetting("scheduler.lastResult", ""),
  ]);
  let lastResult: { discovery?: { scanned: number; newConversations: number } | null; monitoring?: { refreshed: number; manual: number } | null; actionsGenerated?: number; errors?: string[] } | null = null;
  try { lastResult = lastResultRaw ? JSON.parse(lastResultRaw) : null; } catch { lastResult = null; }

  async function setField(formData: FormData) {
    "use server";
    await saveSetting(String(formData.get("key")), String(formData.get("value") ?? ""));
    revalidatePath("/settings");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-[13px] text-zinc-500">What the agent listens for, where, and what it is allowed to say. Change the first two to point Pulse at another health area.</p>
      </div>

      <Card title="What we listen for" hint="One term per line. Every 30 min the agent reads the newest posts in each enabled community and keeps those mentioning any term.">
        <div className="space-y-3">
          {categories.map((c) => (
            <ActionForm key={c.id} action={async (fd: FormData) => { "use server"; await saveSearchCategory(c.id, String(fd.get("terms") ?? "").split("\n").map((t) => t.trim()).filter(Boolean), fd.get("enabled") === "on"); }} className="rounded-md border border-zinc-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">{c.name}</span>
                <label className="flex items-center gap-1 text-[12px] text-zinc-500"><input type="checkbox" name="enabled" defaultChecked={c.enabled} /> enabled</label>
              </div>
              <textarea name="terms" rows={3} defaultValue={c.terms.join("\n")} className={input} />
              <div className="mt-2"><SubmitButton /></div>
            </ActionForm>
          ))}
        </div>
      </Card>

      <Card title="Where we listen" hint="Communities the agent scans, and whether we are allowed to reply there and in what tone.">
        {communities.map((c) => (
          <ActionForm key={c.id} action={async (fd: FormData) => { "use server"; await saveCommunity(c.id, {
            enabled: fd.get("enabled") === "on",
            tone: String(fd.get("tone") ?? ""),
            promotionSensitivity: String(fd.get("promotionSensitivity") ?? "MEDIUM"),
            minRelevanceScore: Number(fd.get("minRelevanceScore") ?? 0),
            dmAllowed: fd.get("dmAllowed") === "on",
            folerIntroAllowed: fd.get("folerIntroAllowed") === "on",
            notes: String(fd.get("notes") ?? ""),
            rulesUrl: String(fd.get("rulesUrl") ?? ""),
          }); }} className="mb-3 rounded-md border border-zinc-200 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <span className="font-medium">r/{c.name}</span>
              <label className="flex items-center gap-1 text-[12px] text-zinc-500"><input type="checkbox" name="enabled" defaultChecked={c.enabled} /> enabled</label>
              <label className="flex items-center gap-1 text-[12px] text-zinc-500"><input type="checkbox" name="dmAllowed" defaultChecked={c.dmAllowed} /> DMs</label>
              <label className="flex items-center gap-1 text-[12px] text-zinc-500"><input type="checkbox" name="folerIntroAllowed" defaultChecked={c.folerIntroAllowed} /> FOLĒR intro</label>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <input name="tone" placeholder="Tone, e.g. warm and practical" defaultValue={c.tone} className={input} />
              <select name="promotionSensitivity" defaultValue={c.promotionSensitivity} className={input}>
                {["LOW", "MEDIUM", "HIGH"].map((s) => <option key={s}>{s}</option>)}
              </select>
              <input name="minRelevanceScore" type="number" placeholder="Min relevance score" defaultValue={c.minRelevanceScore} className={input} />
              <input name="rulesUrl" placeholder="Link to community rules" defaultValue={c.rulesUrl} className={input} />
            </div>
            <textarea name="notes" placeholder="Notes for the drafter" defaultValue={c.notes} rows={2} className={`${input} mt-2`} />
            <div className="mt-2"><SubmitButton /></div>
          </ActionForm>
        ))}
        <ActionForm action={async (fd: FormData) => { "use server"; return addCommunity(String(fd.get("name") ?? "").replace(/^r\//, "").trim()); }} className="flex gap-2">
          <input name="name" required pattern="(r/)?[A-Za-z0-9_]{2,21}" title="Subreddit name, e.g. tressless" placeholder="Add a subreddit, e.g. tressless" className={input} />
          <SubmitButton>Add</SubmitButton>
        </ActionForm>
      </Card>

      <Card title="What we may say about FOLĒR" hint="The only facts Claude may use when FOLĒR comes up. Anything under prohibited is stripped from drafts.">
        {([
          [SETTING_KEYS.kbProductDescription, "Product description", kb.productDescription],
          [SETTING_KEYS.kbApprovedClaims, "Approved claims", kb.approvedClaims],
          [SETTING_KEYS.kbProhibitedClaims, "Prohibited claims", kb.prohibitedClaims],
          [SETTING_KEYS.kbCurrentCapabilities, "Current capabilities", kb.currentCapabilities],
          [SETTING_KEYS.kbLimitations, "Limitations", kb.limitations],
        ] as const).map(([key, label, value]) => (
          <ActionForm key={key} action={setField} className="mb-3">
            <input type="hidden" name="key" value={key} />
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
            <textarea name="value" rows={3} defaultValue={value} className={input} />
            <div className="mt-1"><SubmitButton /></div>
          </ActionForm>
        ))}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <ActionForm action={setField}>
            <input type="hidden" name="key" value={SETTING_KEYS.waitlistUrl} />
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Waitlist URL</div>
            <input name="value" defaultValue={waitlistUrl} className={input} />
            <div className="mt-1"><SubmitButton /></div>
          </ActionForm>
          <ActionForm action={setField}>
            <input type="hidden" name="key" value={SETTING_KEYS.attributionCampaign} />
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Campaign tag (added to the link)</div>
            <input name="value" defaultValue={campaign} className={input} />
            <div className="mt-1"><SubmitButton /></div>
          </ActionForm>
          <ActionForm action={setField}>
            <input type="hidden" name="key" value="attribution.useRedirect" />
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Count link clicks</div>
            <select name="value" defaultValue={useRedirect} className={input}>
              <option value="false">Off — link goes straight to the waitlist</option>
              <option value="true">On — link passes through Pulse first</option>
            </select>
            <div className="mt-1"><SubmitButton /></div>
          </ActionForm>
        </div>
      </Card>

      <Card title="Reddit connection" hint="How the agent reads Reddit, and which account your comments come from (so they are recognised in threads).">
        <div className="mb-3 text-zinc-500">
          Using <b>{providerLabel[provider.name]}</b> — it can{" "}
          {[provider.capabilities.search && "search", provider.capabilities.readConversation && "read threads", provider.capabilities.monitorReplies && "watch for replies", provider.capabilities.createComment && "post comments"].filter(Boolean).join(", ")}
          {!provider.capabilities.createComment && "; posting is always done by you"}.
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ActionForm action={setField}>
            <input type="hidden" name="key" value={SETTING_KEYS.redditProvider} />
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">How we read Reddit</div>
            <select name="value" defaultValue={providerSetting} className={input}>
              <option value="public_web">Public web — real posts, no API key</option>
              <option value="official_api">Official API — needs Reddit app credentials</option>
              <option value="mock">Demo data — nothing real</option>
            </select>
            <div className="mt-1"><SubmitButton /></div>
          </ActionForm>
          <ActionForm action={setField}>
            <input type="hidden" name="key" value={SETTING_KEYS.redditOurUsername} />
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Your Reddit username (the one you post from)</div>
            <input name="value" defaultValue={redditUser} className={input} />
            <div className="mt-1"><SubmitButton /></div>
          </ActionForm>
        </div>
      </Card>

      <Card title="Add a post yourself" hint="Saw a thread the agent missed? Paste its link and it gets read, analyzed and added to People like any other.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <form action={async (fd: FormData) => { "use server"; const r = await importRedditUrlForm(String(fd.get("url") ?? "")); redirect(`/conversations/${r.conversationId}`); }} className="rounded-md border border-zinc-200 p-3">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">By link</div>
            <input name="url" required placeholder="https://www.reddit.com/r/…/comments/…" className={input} />
            <div className="mt-2"><SubmitButton>Read this thread</SubmitButton></div>
          </form>
          <form action={async (fd: FormData) => { "use server"; const r = await pastePostForm(fd); redirect(`/conversations/${r.conversationId}`); }} className="rounded-md border border-zinc-200 p-3 space-y-1">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">By copy-paste (if Reddit blocks the server)</div>
            <input name="url" placeholder="Post URL" required className={input} />
            <div className="grid grid-cols-2 gap-1">
              <input name="subreddit" placeholder="Subreddit" required className={input} />
              <input name="author" placeholder="Author username" required className={input} />
            </div>
            <input name="title" placeholder="Post title" required className={input} />
            <textarea name="body" placeholder="Post text" rows={2} className={input} />
            <SubmitButton>Add post</SubmitButton>
          </form>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Safety brake" hint="Outbound pauses itself on removals or rate limits. Resume when you have checked the account.">
          <div className="space-y-1 text-[12px]">
            <div>
              {health?.outboundPaused
                ? <span className="font-medium text-red-700">Paused{health.pausedReason ? ` — ${health.pausedReason}` : ""}{health.pausedUntil ? ` (until ${health.pausedUntil.toISOString().slice(0, 16).replace("T", " ")})` : ""}</span>
                : <span className="font-medium text-emerald-700">Running normally</span>}
            </div>
            <div>Comments posted today: {health?.commentsToday ?? 0}</div>
            <div>Removed by mods: {health?.removals ?? 0} · Restrictions: {health?.restrictions ?? 0} · Rate limits hit: {health?.rateLimitHits ?? 0}</div>
            {health?.lastError && <div className="break-words text-red-600 [overflow-wrap:anywhere]">Last error: {health.lastError}</div>}
            {health?.outboundPaused && <div className="pt-2"><ActionButton label="Resume outbound" action={resumeOutboundAction} /></div>}
          </div>
        </Card>
        <Card title="Automatic cycle" hint="Discovery + reply check, every 30 min. Run it now if you don't want to wait.">
          <div className="space-y-1 text-[12px]">
            <div>Last run: {lastRunAt ? lastRunAt.slice(0, 16).replace("T", " ") + " UTC" : "never on this server"}</div>
            {lastResult && (
              <>
                <div>
                  {lastResult.discovery ? `Read ${lastResult.discovery.scanned} posts, ${lastResult.discovery.newConversations} new people` : "No discovery"}
                  {" · "}{lastResult.monitoring ? `checked ${lastResult.monitoring.refreshed} threads` : "no threads checked"}
                  {" · "}{lastResult.actionsGenerated ?? 0} replies drafted
                </div>
                {(lastResult.errors?.length ?? 0) > 0 && (
                  <div className="break-words text-red-600 [overflow-wrap:anywhere]">{lastResult.errors!.slice(0, 3).join("; ")}</div>
                )}
              </>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-2"><ActionButton label="Run cycle now" action={runCycleNowAction} /><span className="text-zinc-400">Discovery + reply check; can take a few minutes at Reddit&apos;s pace.</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
