import { prisma } from "@/lib/db";

export const SETTING_KEYS = {
  kbProductDescription: "kb.productDescription",
  kbApprovedClaims: "kb.approvedClaims",
  kbProhibitedClaims: "kb.prohibitedClaims",
  kbCurrentCapabilities: "kb.currentCapabilities",
  kbLimitations: "kb.limitations",
  waitlistUrl: "waitlist.url",
  redditProvider: "reddit.provider",
  redditOurUsername: "reddit.ourUsername",
  attributionCampaign: "attribution.campaign",
  discoveryPostsScanned: "discovery.postsScanned",
} as const;

export const KNOWLEDGE_BASE_DEFAULTS = {
  productDescription:
    "FOLĒR is an early-stage startup building technology to help people objectively track hair and scalp changes over time, instead of relying on memory or inconsistent photos.",
  approvedClaims:
    "We are building a way to make hair and scalp change more measurable over time.\nWe are early stage and opening an early waitlist.\nConsistent lighting, angle and distance matter a lot when comparing photos.",
  prohibitedClaims:
    "Any claim that FOLĒR diagnoses, treats, cures or prevents hair loss.\nAny claim of clinical validation, FDA/CE clearance or accuracy figures.\nAny statement about whether a specific medication is or is not working for the person.\nAny promise about shipping dates or pricing.",
  currentCapabilities: "Early prototype. Not publicly available. Waitlist only.",
  limitations: "Does not diagnose. Does not replace a dermatologist. Not yet validated in a clinical setting.",
  waitlistUrl: "",
} as const;

export interface KnowledgeBase {
  productDescription: string;
  approvedClaims: string;
  prohibitedClaims: string;
  currentCapabilities: string;
  limitations: string;
  waitlistUrl: string;
}

export async function getSetting(key: string, fallback: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function getKnowledgeBase(): Promise<KnowledgeBase> {
  const [productDescription, approvedClaims, prohibitedClaims, currentCapabilities, limitations, waitlistUrl] =
    await Promise.all([
      getSetting(SETTING_KEYS.kbProductDescription, KNOWLEDGE_BASE_DEFAULTS.productDescription),
      getSetting(SETTING_KEYS.kbApprovedClaims, KNOWLEDGE_BASE_DEFAULTS.approvedClaims),
      getSetting(SETTING_KEYS.kbProhibitedClaims, KNOWLEDGE_BASE_DEFAULTS.prohibitedClaims),
      getSetting(SETTING_KEYS.kbCurrentCapabilities, KNOWLEDGE_BASE_DEFAULTS.currentCapabilities),
      getSetting(SETTING_KEYS.kbLimitations, KNOWLEDGE_BASE_DEFAULTS.limitations),
      getSetting(SETTING_KEYS.waitlistUrl, KNOWLEDGE_BASE_DEFAULTS.waitlistUrl),
    ]);
  return { productDescription, approvedClaims, prohibitedClaims, currentCapabilities, limitations, waitlistUrl };
}
