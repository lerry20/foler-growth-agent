import { prisma } from "../src/lib/db";
import { setSetting, SETTING_KEYS, KNOWLEDGE_BASE_DEFAULTS, getSetting } from "../src/lib/settings";
import { MockProvider } from "../src/lib/reddit/mock";
import { ingestConversation } from "../src/lib/ingest";
import { qualifyConversation } from "../src/lib/ai/analyze";

const CATEGORIES: { key: string; name: string; terms: string[] }[] = [
  {
    key: "MEASUREMENT",
    name: "Measurement",
    terms: [
      "how do I measure hair density",
      "how do I measure hair growth",
      "how do I know if minoxidil is working",
      "how do I track hair progress",
      "hair progress tracking",
      "hair density measurement",
      "hair growth tracking",
      "before and after hair photos",
      "how to compare hair density",
    ],
  },
  {
    key: "UNCERTAINTY",
    name: "Uncertainty",
    terms: [
      "can't tell if minoxidil is working",
      "don't know if minoxidil is working",
      "can't see a difference",
      "is this working",
      "how do I know if it's working",
      "can't tell if my hair is getting thinner",
      "am I actually losing hair",
      "photos aren't consistent",
    ],
  },
  {
    key: "TREATMENT_JOURNEY",
    name: "Treatment journey",
    terms: [
      "started minoxidil",
      "minoxidil progress",
      "minoxidil 3 months",
      "minoxidil 6 months",
      "finasteride progress",
      "finasteride 3 months",
      "PRP hair progress",
      "hair transplant progress",
      "hair treatment results",
    ],
  },
  {
    key: "HAIR_PROBLEMS",
    name: "Hair problems",
    terms: [
      "thinning",
      "shedding",
      "receding hairline",
      "crown thinning",
      "diffuse thinning",
      "hair density",
      "balding",
      "hair growth",
      "scalp health",
    ],
  },
  {
    key: "PRODUCT_INTENT",
    name: "Product intent",
    terms: [
      "hair loss device",
      "hair tracking device",
      "hair density device",
      "hair scanner",
      "hair analysis",
      "hair tracking app",
      "scalp scanner",
      "hair monitoring",
    ],
  },
];

const COMMUNITIES: { name: string; enabled: boolean; promotionSensitivity: string; notes: string }[] = [
  { name: "tressless", enabled: true, promotionSensitivity: "HIGH", notes: "No self-promotion; be extremely careful" },
  { name: "HairlossResearch", enabled: true, promotionSensitivity: "MEDIUM", notes: "" },
  { name: "Hairloss", enabled: true, promotionSensitivity: "MEDIUM", notes: "" },
  { name: "FemaleHairLoss", enabled: true, promotionSensitivity: "MEDIUM", notes: "" },
  { name: "minoxidilbeards", enabled: false, promotionSensitivity: "MEDIUM", notes: "" },
];

async function main() {
  for (const c of CATEGORIES) {
    await prisma.searchCategory.upsert({
      where: { key: c.key },
      update: { name: c.name, terms: c.terms },
      create: { key: c.key, name: c.name, terms: c.terms },
    });
  }

  const allowedActions = ["HELP", "ENGAGE", "FOLLOW_UP", "INTRODUCE_FOLER", "WAITLIST_INVITE"] as const;
  for (const c of COMMUNITIES) {
    await prisma.communityConfig.upsert({
      where: { name: c.name },
      update: { enabled: c.enabled, promotionSensitivity: c.promotionSensitivity, notes: c.notes },
      create: {
        name: c.name,
        enabled: c.enabled,
        promotionSensitivity: c.promotionSensitivity,
        notes: c.notes,
        allowedActions: [...allowedActions],
        dmAllowed: false,
      },
    });
  }

  await prisma.accountHealth.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });

  const kbEntries: [string, string][] = [
    [SETTING_KEYS.kbProductDescription, KNOWLEDGE_BASE_DEFAULTS.productDescription],
    [SETTING_KEYS.kbApprovedClaims, KNOWLEDGE_BASE_DEFAULTS.approvedClaims],
    [SETTING_KEYS.kbProhibitedClaims, KNOWLEDGE_BASE_DEFAULTS.prohibitedClaims],
    [SETTING_KEYS.kbCurrentCapabilities, KNOWLEDGE_BASE_DEFAULTS.currentCapabilities],
    [SETTING_KEYS.kbLimitations, KNOWLEDGE_BASE_DEFAULTS.limitations],
    [SETTING_KEYS.attributionCampaign, "reddit-growth-agent"],
  ];
  for (const [key, value] of kbEntries) {
    if ((await getSetting(key, "")) === "") await setSetting(key, value);
  }

  if (process.env.SEED_MOCK !== "0" && process.env.NODE_ENV !== "production") {
    const provider = new MockProvider();
    const { MOCK_CONVERSATIONS } = await import("../src/lib/reddit/mockData");
    for (const c of MOCK_CONVERSATIONS) {
      const convo = await provider.getConversation(c.post.id);
      const res = await ingestConversation(convo.post, convo.comments, "MOCK");
      if (res.created) {
        const analysis = await qualifyConversation(res.conversationId);
        console.log(
          `qualified ${convo.post.title.slice(0, 60)} -> ${analysis.recommended_action} (${analysis.provider})`,
        );
      }
    }
  }

  console.log("Seed complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
