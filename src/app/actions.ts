"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { runDiscovery } from "@/lib/discovery";
import { generateActionsForCandidates, generateAction, approveAction, rejectAction, snoozeAction, markPosted } from "@/lib/actions";
import { refreshAll, refreshConversation, importReplyManually } from "@/lib/monitoring";
import { qualifyConversation } from "@/lib/ai/analyze";
import { setSetting } from "@/lib/settings";
import { resumeOutbound } from "@/lib/health";
import { importConversationFromText, importConversationFromUrl } from "@/lib/reddit/manualImport";
import { isTelegramConfigured, sendMessage } from "@/lib/telegram/client";
import { env } from "@/lib/env";

export async function runDiscoveryAction() {
  const r = await runDiscovery();
  revalidatePath("/");
  return r;
}

export async function runCopilotAction() {
  const n = await generateActionsForCandidates();
  revalidatePath("/");
  return { generated: n };
}

export async function refreshAllAction() {
  const r = await refreshAll();
  revalidatePath("/");
  return r;
}

export async function approveActionForm(actionId: string, finalResponse?: string) {
  const r = await approveAction(actionId, { by: "dashboard", finalResponse });
  revalidatePath("/conversations");
  return r;
}

export async function rejectActionForm(actionId: string) {
  await rejectAction(actionId, { by: "dashboard" });
  revalidatePath("/conversations");
}

export async function snoozeActionForm(actionId: string, hours = 24) {
  await snoozeAction(actionId, hours);
  revalidatePath("/conversations");
}

export async function markPostedForm(actionId: string) {
  await markPosted(actionId, { by: "dashboard" });
  revalidatePath("/conversations");
}

export async function generateActionForm(conversationId: string) {
  const a = await generateAction(conversationId);
  revalidatePath(`/conversations/${conversationId}`);
  return a?.id ?? null;
}

export async function reanalyzeForm(conversationId: string) {
  await qualifyConversation(conversationId, { force: true });
  revalidatePath(`/conversations/${conversationId}`);
}

export async function refreshConversationForm(conversationId: string) {
  const r = await refreshConversation(conversationId);
  revalidatePath(`/conversations/${conversationId}`);
  return r;
}

export async function importReplyForm(conversationId: string, formData: FormData) {
  const author = String(formData.get("author") ?? "");
  const content = String(formData.get("content") ?? "");
  if (!author || !content) return { ok: false };
  await importReplyManually(conversationId, { author, content });
  revalidatePath(`/conversations/${conversationId}`);
  return { ok: true };
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
  await prisma.communityConfig.upsert({
    where: { name },
    update: {},
    create: { name, allowedActions: ["HELP", "ENGAGE", "FOLLOW_UP", "INTRODUCE_FOLER", "WAITLIST_INVITE"] },
  });
  revalidatePath("/settings");
}

export async function resumeOutboundAction() {
  await resumeOutbound();
  revalidatePath("/settings");
}

export async function importRedditUrlForm(url: string) {
  const r = await importConversationFromUrl(url);
  revalidatePath("/conversations");
  return r;
}

export async function pastePostForm(formData: FormData) {
  const r = await importConversationFromText({
    url: String(formData.get("url") ?? ""),
    subreddit: String(formData.get("subreddit") ?? ""),
    author: String(formData.get("author") ?? ""),
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    createdAt: new Date(String(formData.get("createdAt") ?? Date.now())),
  });
  revalidatePath("/conversations");
  return { conversationId: r.conversationId };
}

export async function sendTestTelegram() {
  if (!isTelegramConfigured() || !env.TELEGRAM_CHAT_ID) return { ok: false };
  const res = await sendMessage(env.TELEGRAM_CHAT_ID, "FOLĒR Growth Agent test message ✅");
  return { ok: Boolean(res?.ok) };
}
