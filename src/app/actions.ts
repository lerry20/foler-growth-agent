"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { runDiscovery } from "@/lib/discovery";
import { generateActionsForCandidates, generateAction, approveAction, rejectAction, snoozeAction, markPosted, requestApproval } from "@/lib/actions";
import { refreshAll, refreshConversation, importReplyManually } from "@/lib/monitoring";
import { qualifyConversation } from "@/lib/ai/analyze";
import { setSetting } from "@/lib/settings";
import { resumeOutbound } from "@/lib/health";
import { importConversationFromText, importConversationFromUrl } from "@/lib/reddit/manualImport";
import type { Intent, SpeaksAbout, StruggleVerdict } from "@prisma/client";
import { reviewVoice, clearReview, SPEAKS_ABOUT_LABELS } from "@/lib/voices/review";
import { reviewLabel, clearLabelReview, isStruggleTag, noteLabel, reviewIntent, clearIntentReview, NO_STRUGGLE } from "@/lib/insights/labelReview";
import { INTENT_LABEL, INTENTS } from "@/lib/insights/intent";
import { STRUGGLE_LABELS } from "@/lib/insights/taxonomy";

const REDDIT_BLOCKED = /403|429|blocked|rate limited|forbidden/i;
const REDDIT_BLOCKED_MSG = "Reddit refuses requests from this server — this runs from the local agent every 30 min instead.";

function refreshLists() {
  revalidatePath("/");
  revalidatePath("/conversations");
  revalidatePath("/people");
  revalidatePath("/outreach");
}

export async function runDiscoveryAction() {
  const r = await runDiscovery();
  revalidatePath("/");
  const blocked = r.scanned === 0 && r.errors.some((e) => REDDIT_BLOCKED.test(e));
  const message = blocked
    ? REDDIT_BLOCKED_MSG
    : `Read ${r.scanned} posts · ${r.newConversations} new ${r.newConversations === 1 ? "person" : "people"}${r.errors.length ? ` · ${r.errors.length} errors` : ""}`;
  revalidatePath("/people");
  return { ...r, message };
}

export async function runCopilotAction() {
  const n = await generateActionsForCandidates();
  revalidatePath("/");
  revalidatePath("/outreach");
  const message = n === 0 ? "Nothing new to draft — every analyzed conversation already has a reply." : `Drafted ${n} ${n === 1 ? "reply" : "replies"} — waiting for your approval in Outreach.`;
  return { generated: n, message };
}

export async function refreshAllAction() {
  const r = await refreshAll();
  revalidatePath("/");
  const blocked = r.refreshed === 0 && (r.manual > 0 || r.errors.some((e) => REDDIT_BLOCKED.test(e)));
  const message = blocked
    ? REDDIT_BLOCKED_MSG
    : r.refreshed === 0
      ? "No open threads to check."
      : `Checked ${r.refreshed} ${r.refreshed === 1 ? "thread" : "threads"} for new replies.`;
  return { ...r, message };
}

export async function approveActionForm(actionId: string, finalResponse?: string) {
  const r = await approveAction(actionId, { by: "dashboard", finalResponse });
  refreshLists();
  return { ...r, message: r.ok ? "Approved — now copy it and post it on Reddit." : `Not approved: ${r.reason}` };
}

export async function rejectActionForm(actionId: string) {
  await rejectAction(actionId, { by: "dashboard" });
  refreshLists();
  return { message: "Rejected — this draft won't be posted." };
}

export async function snoozeActionForm(actionId: string, hours = 24) {
  await snoozeAction(actionId, hours);
  refreshLists();
  return { message: `Snoozed — comes back in ${hours}h.` };
}

export async function markPostedForm(actionId: string) {
  await markPosted(actionId, { by: "dashboard" });
  refreshLists();
  return { message: "Marked as posted — the agent now watches this thread for replies." };
}

export async function generateActionForm(conversationId: string) {
  const a = await generateAction(conversationId);
  revalidatePath(`/conversations/${conversationId}`);
  refreshLists();
  if (!a) return { message: "No reply drafted — the AI recommends not replying here (or a safety gate blocked it)." };
  await requestApproval(a.id);
  return { message: "Reply drafted — waiting for your approval." };
}

export async function reanalyzeForm(conversationId: string) {
  await qualifyConversation(conversationId, { force: true });
  revalidatePath(`/conversations/${conversationId}`);
  refreshLists();
  return { message: "Re-read the thread and updated the analysis." };
}

export async function refreshConversationForm(conversationId: string) {
  const r = await refreshConversation(conversationId);
  revalidatePath(`/conversations/${conversationId}`);
  refreshLists();
  const message = !r.ok
    ? REDDIT_BLOCKED_MSG
    : r.newMessages
      ? `${r.newMessages} new ${r.newMessages === 1 ? "comment" : "comments"} picked up.`
      : "Checked — nothing new in the thread.";
  return { ...r, message };
}

export async function importReplyForm(conversationId: string, formData: FormData) {
  const author = String(formData.get("author") ?? "");
  const content = String(formData.get("content") ?? "");
  if (!author || !content) return { ok: false, message: "Author and text are required." };
  await importReplyManually(conversationId, { author, content });
  revalidatePath(`/conversations/${conversationId}`);
  refreshLists();
  return { ok: true, message: "Reply added and analyzed." };
}

export async function saveSetting(key: string, value: string) {
  await setSetting(key, value);
  revalidatePath("/settings");
}

export async function saveSearchCategory(id: string, terms: string[], enabled: boolean) {
  await prisma.searchCategory.update({ where: { id }, data: { terms, enabled } });
  revalidatePath("/settings");
}

export async function saveCommunity(id: string, data: {
  enabled: boolean; tone: string; promotionSensitivity: string; minRelevanceScore: number;
  dmAllowed: boolean; folerIntroAllowed: boolean; notes: string; rulesUrl: string;
}) {
  await prisma.communityConfig.update({ where: { id }, data });
  revalidatePath("/settings");
}

export async function addCommunity(name: string) {
  if (!/^[A-Za-z0-9_]{2,21}$/.test(name)) return { message: "Error: enter a subreddit name like tressless" };
  await prisma.communityConfig.upsert({
    where: { name },
    update: {},
    create: { name, allowedActions: ["HELP", "ENGAGE", "FOLLOW_UP", "INTRODUCE_FOLER", "WAITLIST_INVITE"] },
  });
  revalidatePath("/settings");
  return { message: `r/${name} added — the next discovery pass will scan it` };
}

export async function resumeOutboundAction() {
  await resumeOutbound();
  revalidatePath("/settings");
  revalidatePath("/");
  return { message: "Outbound resumed." };
}

export async function importRedditUrlForm(url: string) {
  const r = await importConversationFromUrl(url);
  await qualifyConversation(r.conversationId);
  refreshLists();
  return r;
}

export async function pastePostForm(formData: FormData) {
  const r = await importConversationFromText({
    url: String(formData.get("url") ?? ""),
    subreddit: String(formData.get("subreddit") ?? ""),
    author: String(formData.get("author") ?? ""),
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    createdAt: new Date(),
  });
  await qualifyConversation(r.conversationId);
  refreshLists();
  return { conversationId: r.conversationId };
}

export async function regenerateSynthesisAction() {
  const { generateSynthesis } = await import("@/lib/insights/synthesis");
  const md = await generateSynthesis();
  revalidatePath("/insights");
  return { message: md.startsWith("Synthesis unavailable") ? md : "Key findings rewritten from the current data." };
}


export async function reviewVoiceAction(voiceId: string, speaksAbout: SpeaksAbout, inScope: boolean) {
  if (!(speaksAbout in SPEAKS_ABOUT_LABELS)) throw new Error("Unknown verdict");
  await reviewVoice(voiceId, { speaksAbout, inScope: Boolean(inScope) });
  revalidatePath("/audit");
  revalidatePath("/insights");
  return { message: `Saved: ${SPEAKS_ABOUT_LABELS[speaksAbout].label}${speaksAbout === "OWN_CASE" && !inScope ? " (not hair/scalp)" : ""}` };
}

export async function clearVoiceReviewAction(voiceId: string) {
  await clearReview(voiceId);
  revalidatePath("/audit");
  revalidatePath("/insights");
  return { message: "Your verdict removed — back to the model's decision." };
}

const LABEL_VERDICTS: StruggleVerdict[] = ["RIGHT", "WRONG", "MISSED"];

/** `shouldBe` (WRONG only): the struggle the quote really shows, or NONE for "no struggle here". */
export async function reviewLabelAction(conversationId: string, tag: string, verdict: StruggleVerdict, shouldBe?: string | null) {
  if (!isStruggleTag(tag)) throw new Error("Unknown struggle label");
  if (!LABEL_VERDICTS.includes(verdict)) throw new Error("Unknown verdict");
  if (shouldBe && shouldBe !== NO_STRUGGLE && !isStruggleTag(shouldBe)) throw new Error("Unknown struggle label");
  await reviewLabel(conversationId, tag, verdict, shouldBe);
  revalidatePath("/audit");
  revalidatePath("/insights");
  const name = STRUGGLE_LABELS[tag];
  const message =
    verdict === "RIGHT"
      ? `“${name}” confirmed — stays in Insights.`
      : verdict === "MISSED"
        ? `“${name}” added to Insights for this thread.`
        : shouldBe && isStruggleTag(shouldBe)
          ? `“${name}” → “${STRUGGLE_LABELS[shouldBe]}” in Insights; the mistake goes into the next classifier's examples.`
          : shouldBe === NO_STRUGGLE
            ? `“${name}” removed — no struggle counted for this thread; saved as a mistake for the next classifier.`
            : `“${name}” removed from Insights — now say what it should be.`;
  return { message };
}

export async function noteLabelAction(conversationId: string, tag: string, note: string) {
  await noteLabel(conversationId, tag, note);
  revalidatePath("/audit");
  return { message: "Note saved with your verdict." };
}

export async function reviewIntentAction(conversationId: string, intent: Intent) {
  if (!INTENTS.includes(intent)) throw new Error("Unknown intent");
  await reviewIntent(conversationId, intent);
  revalidatePath("/audit");
  revalidatePath("/insights");
  return { message: `Intent set to “${INTENT_LABEL[intent]}” — overrides the engine in Insights.` };
}

export async function clearIntentReviewAction(conversationId: string) {
  await clearIntentReview(conversationId);
  revalidatePath("/audit");
  revalidatePath("/insights");
  return { message: "Intent correction removed — back to what the engine said." };
}

export async function clearLabelReviewAction(conversationId: string, tag: string) {
  await clearLabelReview(conversationId, tag);
  revalidatePath("/audit");
  revalidatePath("/insights");
  return { message: "Your verdict removed — back to what the engine said." };
}

export async function runCycleNowAction() {
  const { runScheduledCycle } = await import("@/lib/scheduler");
  const r = await runScheduledCycle();
  revalidatePath("/settings");
  revalidatePath("/");
  if (r.skipped) return { ...r, message: "A cycle is already running." };
  const blocked = r.errors.some((e) => REDDIT_BLOCKED.test(e)) && (r.discovery?.scanned ?? 0) === 0;
  const message = blocked
    ? REDDIT_BLOCKED_MSG
    : `Done in ${Math.round(r.durationMs / 1000)}s — ${r.discovery?.newConversations ?? 0} new people, ${r.actionsGenerated} replies drafted, ${r.monitoring?.refreshed ?? 0} threads checked.`;
  return { ...r, message };
}
