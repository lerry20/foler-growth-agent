import { prisma } from "@/lib/db";
import { getSetting, SETTING_KEYS } from "@/lib/settings";

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
    return;
  }
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
