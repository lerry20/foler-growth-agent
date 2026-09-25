import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { advanceStage } from "@/lib/pipeline";

export function buildWaitlistUrl(
  base: string,
  params: { subreddit: string; leadId: string; conversationId: string; campaign: string },
): string {
  const url = new URL(base);
  url.searchParams.set("source", "reddit");
  url.searchParams.set("subreddit", params.subreddit);
  url.searchParams.set("lead_id", params.leadId);
  url.searchParams.set("conversation_id", params.conversationId);
  url.searchParams.set("campaign", params.campaign);
  return url.toString();
}

export async function buildTrackedWaitlistUrl(
  base: string,
  params: { subreddit: string; leadId: string; conversationId: string; campaign: string },
): Promise<string> {
  const direct = buildWaitlistUrl(base, params);
  const useRedirect = await getSetting("attribution.useRedirect", "false");
  if (useRedirect !== "true" || !env.APP_BASE_URL) return direct;
  const url = new URL(`${env.APP_BASE_URL}/api/waitlist/go`);
  for (const [k, v] of new URL(direct).searchParams) url.searchParams.set(k, v);
  url.searchParams.set("target", base);
  return url.toString();
}

export async function recordClick(input: { leadId: string; conversationId?: string }): Promise<void> {
  const conversion = await prisma.conversion.findFirst({ where: { leadId: input.leadId } });
  if (conversion) {
    await prisma.conversion.update({ where: { id: conversion.id }, data: { clickedAt: new Date() } });
  } else {
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: input.leadId } });
    const campaign = await getSetting(SETTING_KEYS.attributionCampaign, "reddit-growth-agent");
    await prisma.conversion.create({
      data: { leadId: input.leadId, conversationId: input.conversationId, subreddit: lead.subreddit, source: "reddit", campaign, clickedAt: new Date() },
    });
  }
  if (input.conversationId) {
    const convo = await prisma.conversation.findUnique({ where: { id: input.conversationId } });
    if (convo && convo.permissionState !== "WAITLIST_SIGNUP") {
      await prisma.conversation.update({ where: { id: convo.id }, data: { permissionState: "WAITLIST_CLICKED" } });
      await prisma.event.create({ data: { type: "WAITLIST_CLICKED", leadId: input.leadId, conversationId: convo.id } });
    }
  } else {
    await prisma.event.create({ data: { type: "WAITLIST_CLICKED", leadId: input.leadId } });
  }
}

export async function recordSignup(input: {
  leadId: string;
  conversationId?: string;
  source: string;
}): Promise<void> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: input.leadId } });
  const campaign = await getSetting(SETTING_KEYS.attributionCampaign, "reddit-growth-agent");
  const existing = await prisma.conversion.findFirst({ where: { leadId: input.leadId } });
  if (existing) {
    if (!existing.signedUpAt) {
      await prisma.conversion.update({ where: { id: existing.id }, data: { signedUpAt: new Date(), source: input.source } });
    }
  } else {
    await prisma.conversion.create({
      data: {
        leadId: input.leadId,
        conversationId: input.conversationId,
        subreddit: lead.subreddit,
        source: input.source,
        campaign,
        signedUpAt: new Date(),
        attribution: { leadId: input.leadId, conversationId: input.conversationId, source: input.source, campaign },
      },
    });
  }
  if (input.conversationId) {
    await prisma.conversation.update({
      where: { id: input.conversationId },
      data: { permissionState: "WAITLIST_SIGNUP", stage: "WAITLIST_SIGNUP" },
    });
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: input.leadId } });
    const stage = advanceStage(lead.stage, "WAITLIST_SIGNUP");
    if (stage !== lead.stage) await prisma.lead.update({ where: { id: input.leadId }, data: { stage } });
    const ev = await prisma.event.findFirst({ where: { type: "WAITLIST_SIGNUP", conversationId: input.conversationId } });
    if (!ev) {
      await prisma.event.create({
        data: { type: "WAITLIST_SIGNUP", leadId: input.leadId, conversationId: input.conversationId, payload: { source: input.source } },
      });
    }
  }
}
