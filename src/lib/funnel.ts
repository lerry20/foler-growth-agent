import { prisma } from "@/lib/db";
import { STAGE_ORDER } from "@/lib/pipeline";
import type { LeadStage } from "@prisma/client";

export const FUNNEL_STEPS: { label: string; stage?: LeadStage }[] = [
  { label: "Found", stage: "DISCOVERED" },
  { label: "Relevant" },
  { label: "Analyzed", stage: "QUALIFIED" },
  { label: "We replied", stage: "ENGAGED" },
  { label: "Talking", stage: "ACTIVE_CONVERSATION" },
  { label: "FOLĒR mentioned", stage: "FOLER_INTRODUCED" },
  { label: "Waitlist link sent", stage: "WAITLIST_INVITED" },
  { label: "Signed up", stage: "WAITLIST_SIGNUP" },
];

export async function funnelCounts(): Promise<{ label: string; count: number }[]> {
  const leads = await prisma.lead.findMany({ select: { stage: true, category: true } });
  return FUNNEL_STEPS.map((s) => ({
    label: s.label,
    count: s.stage
      ? leads.filter((l) => STAGE_ORDER.indexOf(l.stage) >= STAGE_ORDER.indexOf(s.stage!)).length
      : leads.filter((l) => l.category !== "IGNORE").length,
  }));
}
