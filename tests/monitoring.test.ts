import { beforeEach, describe, expect, it, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { setProviderForTests } from "@/lib/reddit";
import { MockProvider } from "@/lib/reddit/mock";
import { ingestConversation } from "@/lib/ingest";
import { importReplyManually } from "@/lib/monitoring";
import { setSetting, SETTING_KEYS } from "@/lib/settings";
import { MOCK_CONVERSATIONS, OUR_MOCK_USERNAME } from "@/lib/reddit/mockData";
import { resetDb } from "./helpers";

describe("monitoring", () => {
  beforeEach(async () => {
    await resetDb();
    env.ANTHROPIC_API_KEY = "";
    setProviderForTests(new MockProvider());
    await setSetting(SETTING_KEYS.redditOurUsername, OUR_MOCK_USERNAME);
  });
  afterEach(() => setProviderForTests(null));

  it("importReplyManually attaches to the conversation and fires USER_REPLIED + reanalysis", async () => {
    const r = await ingestConversation(MOCK_CONVERSATIONS[0].post, MOCK_CONVERSATIONS[0].comments, "MOCK");
    await importReplyManually(r.conversationId, { author: "mock_shedding_sam", content: "thanks, how often should I take photos?" });
    const msg = await prisma.message.findFirst({ where: { conversationId: r.conversationId, content: { contains: "how often" } } });
    expect(msg).toBeTruthy();
    expect(msg!.direction).toBe("INBOUND");
    const ev = await prisma.event.findFirst({ where: { conversationId: r.conversationId, type: "USER_REPLIED" } });
    expect(ev).toBeTruthy();
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: r.conversationId } });
    expect(convo.lastAnalyzedAt).toBeTruthy();
  });
});
