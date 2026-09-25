import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { setProviderForTests } from "@/lib/reddit";
import { MockProvider } from "@/lib/reddit/mock";
import { ingestConversation } from "@/lib/ingest";
import { qualifyConversation } from "@/lib/ai/analyze";
import { generateAction } from "@/lib/actions";
import { handleUpdate } from "@/lib/telegram/handler";
import { setSetting, SETTING_KEYS } from "@/lib/settings";
import { MOCK_CONVERSATIONS, OUR_MOCK_USERNAME } from "@/lib/reddit/mockData";
import { resetDb } from "./helpers";

vi.mock("@/lib/telegram/client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/telegram/client")>();
  return {
    ...orig,
    sendMessage: vi.fn().mockResolvedValue({ ok: true, result: { message_id: 1 } }),
    editMessageText: vi.fn().mockResolvedValue({ ok: true }),
    answerCallbackQuery: vi.fn().mockResolvedValue({ ok: true }),
  };
});

const { answerCallbackQuery } = await import("@/lib/telegram/client");

function cb(data: string, chatId = 42): Parameters<typeof handleUpdate>[0] {
  return {
    update_id: 1,
    callback_query: { id: "cbq1", data, message: { chat: { id: chatId }, message_id: 99, text: "orig" } },
  };
}

describe("telegram handler", () => {
  beforeEach(async () => {
    await resetDb();
    env.ANTHROPIC_API_KEY = "";
    env.TELEGRAM_CHAT_ID = "42";
    setProviderForTests(new MockProvider());
    await setSetting(SETTING_KEYS.redditOurUsername, OUR_MOCK_USERNAME);
    await prisma.communityConfig.create({ data: { name: "tressless", allowedActions: ["HELP", "ENGAGE", "FOLLOW_UP", "INTRODUCE_FOLER", "WAITLIST_INVITE"], minRelevanceScore: 0 } });
  });
  afterEach(() => {
    setProviderForTests(null);
    env.TELEGRAM_CHAT_ID = "";
  });

  it("approve callback with matching version approves and executes", async () => {
    const r = await ingestConversation(MOCK_CONVERSATIONS[1].post, MOCK_CONVERSATIONS[1].comments, "MOCK");
    await qualifyConversation(r.conversationId);
    const action = await generateAction(r.conversationId);
    await handleUpdate(cb(`cb:approve:${action!.id}:${action!.conversationVersion}`));
    const updated = await prisma.action.findUniqueOrThrow({ where: { id: action!.id } });
    expect(["POSTED", "APPROVED", "EXECUTING", "MANUAL_REQUIRED"]).toContain(updated.status);
  });

  it("mismatched version -> stale, no execution", async () => {
    const r = await ingestConversation(MOCK_CONVERSATIONS[1].post, MOCK_CONVERSATIONS[1].comments, "MOCK");
    await qualifyConversation(r.conversationId);
    const action = await generateAction(r.conversationId);
    await handleUpdate(cb(`cb:approve:${action!.id}:999`));
    const updated = await prisma.action.findUniqueOrThrow({ where: { id: action!.id } });
    expect(updated.status).not.toBe("POSTED");
    expect(await prisma.message.count({ where: { actionId: action!.id, direction: "OUTBOUND" } })).toBe(0);
    expect(vi.mocked(answerCallbackQuery)).toHaveBeenCalledWith("cbq1", expect.stringMatching(/stale/i));
  });

  it("unauthorized chat is ignored", async () => {
    await handleUpdate(cb("cb:approve:whatever:1", 999));
    expect(vi.mocked(answerCallbackQuery)).toHaveBeenCalledWith("cbq1", "Unauthorized");
  });

  it("unset TELEGRAM_CHAT_ID -> approve callback does nothing", async () => {
    const r = await ingestConversation(MOCK_CONVERSATIONS[1].post, MOCK_CONVERSATIONS[1].comments, "MOCK");
    await qualifyConversation(r.conversationId);
    const action = await generateAction(r.conversationId);
    env.TELEGRAM_CHAT_ID = "";
    await handleUpdate(cb(`cb:approve:${action!.id}:${action!.conversationVersion}`, 42));
    const updated = await prisma.action.findUniqueOrThrow({ where: { id: action!.id } });
    expect(updated.status).toBe("PROPOSED");
    expect(await prisma.message.count({ where: { actionId: action!.id, direction: "OUTBOUND" } })).toBe(0);
    expect(vi.mocked(answerCallbackQuery)).toHaveBeenCalledWith("cbq1", "Bot not configured: set TELEGRAM_CHAT_ID");
  });
});
