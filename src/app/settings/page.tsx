import { prisma } from "@/lib/db";
import { getKnowledgeBase, getSetting, SETTING_KEYS } from "@/lib/settings";
import { env } from "@/lib/env";
import { getRedditProvider, providerLabel } from "@/lib/reddit";
import { isTelegramConfigured } from "@/lib/telegram/client";
import { Card } from "@/components/Funnel";
import { ActionButton } from "@/components/buttons";
import {
  saveSetting, saveSearchCategory, saveCommunity, addCommunity,
  resumeOutboundAction, importRedditUrlForm, pastePostForm, sendTestTelegram,
} from "../actions";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const input = "w-full rounded border border-zinc-300 px-2 py-1 text-[12px]";
const btn = "rounded bg-zinc-900 px-3 py-1 text-[12px] text-white";

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
  const lastTelegramEvent = await prisma.event.findFirst({ orderBy: { createdAt: "desc" } });

  async function setField(formData: FormData) {
    "use server";
    await saveSetting(String(formData.get("key")), String(formData.get("value") ?? ""));
    revalidatePath("/settings");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Settings</h1>

      <Card title="Search categories">
        <div className="space-y-3">
          {categories.map((c) => (
            <form key={c.id} action={async (fd: FormData) => { "use server"; await saveSearchCategory(c.id, String(fd.get("terms") ?? "").split("\n").map((t) => t.trim()).filter(Boolean), fd.get("enabled") === "on"); }} className="rounded border border-zinc-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">{c.name} <span className="text-zinc-400">({c.key})</span></span>
                <label className="flex items-center gap-1 text-[12px] text-zinc-500"><input type="checkbox" name="enabled" defaultChecked={c.enabled} /> enabled</label>
              </div>
              <textarea name="terms" rows={3} defaultValue={c.terms.join("\n")} className={input} />
              <button className={`${btn} mt-2`}>Save</button>
            </form>
          ))}
        </div>
      </Card>

      <Card title="Communities">
        {communities.map((c) => (
          <form key={c.id} action={async (fd: FormData) => { "use server"; await saveCommunity(c.id, {
            enabled: fd.get("enabled") === "on",
            tone: String(fd.get("tone") ?? ""),
            promotionSensitivity: String(fd.get("promotionSensitivity") ?? "MEDIUM"),
            minRelevanceScore: Number(fd.get("minRelevanceScore") ?? 0),
            dmAllowed: fd.get("dmAllowed") === "on",
            folerIntroAllowed: fd.get("folerIntroAllowed") === "on",
            notes: String(fd.get("notes") ?? ""),
            rulesUrl: String(fd.get("rulesUrl") ?? ""),
          }); }} className="mb-3 rounded border border-zinc-200 p-3">
            <div className="mb-2 flex items-center gap-3">
              <span className="font-medium">r/{c.name}</span>
              <label className="flex items-center gap-1 text-[12px] text-zinc-500"><input type="checkbox" name="enabled" defaultChecked={c.enabled} /> enabled</label>
              <label className="flex items-center gap-1 text-[12px] text-zinc-500"><input type="checkbox" name="dmAllowed" defaultChecked={c.dmAllowed} /> DMs</label>
              <label className="flex items-center gap-1 text-[12px] text-zinc-500"><input type="checkbox" name="folerIntroAllowed" defaultChecked={c.folerIntroAllowed} /> FOLĒR intro</label>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <input name="tone" placeholder="tone" defaultValue={c.tone} className={input} />
              <select name="promotionSensitivity" defaultValue={c.promotionSensitivity} className={input}>
                {["LOW", "MEDIUM", "HIGH"].map((s) => <option key={s}>{s}</option>)}
              </select>
              <input name="minRelevanceScore" type="number" placeholder="min score" defaultValue={c.minRelevanceScore} className={input} />
              <input name="rulesUrl" placeholder="rules url" defaultValue={c.rulesUrl} className={input} />
            </div>
            <textarea name="notes" placeholder="notes" defaultValue={c.notes} rows={2} className={`${input} mt-2`} />
            <button className={`${btn} mt-2`}>Save</button>
          </form>
        ))}
        <form action={async (fd: FormData) => { "use server"; await addCommunity(String(fd.get("name") ?? "").replace(/^r\//, "")); }} className="flex gap-2">
          <input name="name" placeholder="add subreddit (no r/)" className={input} />
          <button className={btn}>Add</button>
        </form>
      </Card>

      <Card title="Knowledge base">
        {([
          [SETTING_KEYS.kbProductDescription, "Product description", kb.productDescription],
          [SETTING_KEYS.kbApprovedClaims, "Approved claims", kb.approvedClaims],
          [SETTING_KEYS.kbProhibitedClaims, "Prohibited claims", kb.prohibitedClaims],
          [SETTING_KEYS.kbCurrentCapabilities, "Current capabilities", kb.currentCapabilities],
          [SETTING_KEYS.kbLimitations, "Limitations", kb.limitations],
        ] as const).map(([key, label, value]) => (
          <form key={key} action={setField} className="mb-3">
            <input type="hidden" name="key" value={key} />
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
            <textarea name="value" rows={3} defaultValue={value} className={input} />
            <button className={`${btn} mt-1`}>Save</button>
          </form>
        ))}
        <div className="grid grid-cols-3 gap-3">
          <form action={setField}>
            <input type="hidden" name="key" value={SETTING_KEYS.waitlistUrl} />
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Waitlist URL</div>
            <input name="value" defaultValue={waitlistUrl} className={input} />
            <button className={`${btn} mt-1`}>Save</button>
          </form>
          <form action={setField}>
            <input type="hidden" name="key" value={SETTING_KEYS.attributionCampaign} />
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Campaign</div>
            <input name="value" defaultValue={campaign} className={input} />
            <button className={`${btn} mt-1`}>Save</button>
          </form>
          <form action={setField}>
            <input type="hidden" name="key" value="attribution.useRedirect" />
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Use click redirect</div>
            <select name="value" defaultValue={useRedirect} className={input}>
              <option value="false">false</option>
              <option value="true">true</option>
            </select>
            <button className={`${btn} mt-1`}>Save</button>
          </form>
        </div>
      </Card>

      <Card title="Reddit">
        <div className="mb-3 text-zinc-500">
          Current provider: <b>{providerLabel[provider.name]}</b> — capabilities:
          search {String(provider.capabilities.search)}, read {String(provider.capabilities.readConversation)},
          post {String(provider.capabilities.createComment)}, monitor {String(provider.capabilities.monitorReplies)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <form action={setField}>
            <input type="hidden" name="key" value={SETTING_KEYS.redditProvider} />
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Provider</div>
            <select name="value" defaultValue={providerSetting} className={input}>
              {["mock", "public_web", "official_api"].map((p) => <option key={p}>{p}</option>)}
            </select>
            <button className={`${btn} mt-1`}>Save</button>
          </form>
          <form action={setField}>
            <input type="hidden" name="key" value={SETTING_KEYS.redditOurUsername} />
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Our Reddit username</div>
            <input name="value" defaultValue={redditUser} className={input} />
            <button className={`${btn} mt-1`}>Save</button>
          </form>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <form action={async (fd: FormData) => { "use server"; await importRedditUrlForm(String(fd.get("url") ?? "")); }} className="rounded border border-zinc-200 p-3">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Import Reddit URL</div>
            <input name="url" placeholder="https://reddit.com/r/.../comments/..." className={input} />
            <button className={`${btn} mt-2`}>Import</button>
          </form>
          <form action={async (fd: FormData) => { "use server"; await pastePostForm(fd); }} className="rounded border border-zinc-200 p-3 space-y-1">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Paste post manually</div>
            <input name="url" placeholder="post url" required className={input} />
            <input name="subreddit" placeholder="subreddit" required className={input} />
            <input name="author" placeholder="author" required className={input} />
            <input name="title" placeholder="title" required className={input} />
            <textarea name="body" placeholder="body" rows={2} className={input} />
            <button className={btn}>Import</button>
          </form>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Account health">
          <div className="space-y-1 text-[12px]">
            <div>Outbound: {health?.outboundPaused ? `PAUSED (${health.pausedReason ?? ""}${health.pausedUntil ? `, until ${health.pausedUntil.toISOString().slice(0, 16)}` : ""})` : "OK"}</div>
            <div>Comments today: {health?.commentsToday ?? 0} · DMs: {health?.dmsToday ?? 0}</div>
            <div>Removals: {health?.removals ?? 0} · Restrictions: {health?.restrictions ?? 0} · Errors: {health?.errors ?? 0} · Rate limits: {health?.rateLimitHits ?? 0}</div>
            {health?.lastError && <div className="text-red-600">Last error: {health.lastError}</div>}
            <div className="pt-2"><ActionButton label="Resume outbound" action={resumeOutboundAction} /></div>
          </div>
        </Card>
        <Card title="Telegram">
          <div className="space-y-1 text-[12px]">
            <div>Configured: {isTelegramConfigured() ? "yes" : "no"}</div>
            <div>Chat ID set: {env.TELEGRAM_CHAT_ID ? "yes" : "no"}</div>
            <div>Mode: {env.TELEGRAM_MODE}</div>
            <div>Last event: {lastTelegramEvent?.createdAt.toISOString().slice(0, 16).replace("T", " ") ?? "—"}</div>
            <div className="pt-2"><ActionButton label="Send test message" action={sendTestTelegram} /></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
