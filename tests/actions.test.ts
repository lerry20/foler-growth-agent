import { beforeEach, describe, expect, it, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { setProviderForTests } from "@/lib/reddit";
import { MockProvider } from "@/lib/reddit/mock";
import { PublicWebProvider } from "@/lib/reddit/publicWeb";
import { ingestConversation } from "@/lib/ingest";
import { qualifyConversation } from "@/lib/ai/analyze";
import { generateAction, approveAction, rejectAction, markPosted } from "@/lib/actions";
import { setSetting, SETTING_KEYS } from "@/lib/settings";
import { MOCK_CONVERSATIONS, OUR_MOCK_USERNAME } from "@/lib/reddit/mockData";
import { resetDb } from "./helpers";

async function setupConvo(idx: number) {
  const r = await ingestConversation(MOCK_CONVERSATIONS[idx].post, MOCK_CONVERSATIONS[idx].comments, "MOCK");
  await qualifyConversation(r.conversationId);
  return r;
}

describe("actions engine", () => {
  beforeEach(async () => {
    await resetDb();
    env.ANTHROPIC_API_KEY = "";
    setProviderForTests(new MockProvider());
    await setSetting(SETTING_KEYS.redditOurUsername, OUR_MOCK_USERNAME);
    await setSetting(SETTING_KEYS.waitlistUrl, "https://foler.co/waitlist");
    await prisma.communityConfig.create({
      data: { name: "tressless", allowedActions: ["HELP", "ENGAGE", "FOLLOW_UP", "INTRODUCE_FOLER", "WAITLIST_INVITE"], minRelevanceScore: 0 },
    });
    await prisma.communityConfig.create({
      data: { name: "HairlossResearch", allowedActions: ["HELP", "ENGAGE", "FOLLOW_UP", "INTRODUCE_FOLER", "WAITLIST_INVITE"], minRelevanceScore: 0 },
    });
  });
  afterEach(() => setProviderForTests(null));

  it("approve executes with mock provider -> OUTBOUND message + POSTED + COMMENT_POSTED", async () => {
    const { conversationId } = await setupConvo(1);
    const action = await generateAction(conversationId);
    expect(action).toBeTruthy();
    const res = await approveAction(action!.id, { by: "test" });
    expect(res.ok).toBe(true);
    const updated = await prisma.action.findUniqueOrThrow({ where: { id: action!.id } });
    expect(updated.status).toBe("POSTED");
    const msg = await prisma.message.findFirst({ where: { actionId: action!.id, direction: "OUTBOUND" } });
    expect(msg).toBeTruthy();
    const ev = await prisma.event.findFirst({ where: { actionId: action!.id, type: "COMMENT_POSTED" } });
    expect(ev).toBeTruthy();
  });

  it("reject -> no message, no execution", async () => {
    const { conversationId } = await setupConvo(1);
    const action = await generateAction(conversationId);
    await rejectAction(action!.id, { by: "test" });
    expect((await prisma.message.count({ where: { actionId: action!.id } }))).toBe(0);
    expect((await prisma.action.findUniqueOrThrow({ where: { id: action!.id } })).status).toBe("REJECTED");
  });

  it("stale approval refused when new inbound arrives after generation", async () => {
    const { conversationId } = await setupConvo(1);
    const action = await generateAction(conversationId);
    await prisma.message.create({
      data: {
        conversationId,
        redditId: `manual:stale`,
        author: "mock_uncertain_uma",
        content: "a new reply",
        postedAt: new Date(),
        direction: "INBOUND",
      },
    });
    const res = await approveAction(action!.id, { by: "test", expectedVersion: action!.conversationVersion });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/stale/i);
    expect((await prisma.message.count({ where: { actionId: action!.id, direction: "OUTBOUND" } }))).toBe(0);
  });

  it("public_web provider -> MANUAL_REQUIRED, then markPosted posts the message", async () => {
    setProviderForTests(new PublicWebProvider());
    const { conversationId } = await setupConvo(1);
    const action = await generateAction(conversationId);
    const res = await approveAction(action!.id, { by: "test" });
    expect(res.ok).toBe(true);
    expect((await prisma.action.findUniqueOrThrow({ where: { id: action!.id } })).status).toBe("MANUAL_REQUIRED");
    await markPosted(action!.id, { by: "dashboard" });
    const updated = await prisma.action.findUniqueOrThrow({ where: { id: action!.id } });
    expect(updated.status).toBe("POSTED");
    expect(await prisma.message.count({ where: { actionId: action!.id, direction: "OUTBOUND" } })).toBe(1);
  });
});
