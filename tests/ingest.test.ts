import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ingestConversation } from "@/lib/ingest";
import { MOCK_CONVERSATIONS } from "@/lib/reddit/mockData";
import { resetDb } from "./helpers";

describe("ingest dedupe", () => {
  beforeEach(resetDb);

  it("ingesting the same conversation twice yields one lead, one conversation, no dup messages", async () => {
    const c = MOCK_CONVERSATIONS[1];
    const first = await ingestConversation(c.post, c.comments, "MOCK");
    const second = await ingestConversation(c.post, c.comments, "MOCK");
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(await prisma.lead.count()).toBe(1);
    expect(await prisma.conversation.count()).toBe(1);
    const messages = await prisma.message.count({ where: { conversationId: first.conversationId } });
    expect(messages).toBe(1 + c.comments.length);
  });
});
