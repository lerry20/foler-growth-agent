import { beforeEach, describe, expect, it, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { setProviderForTests } from "@/lib/reddit";
import { MockProvider } from "@/lib/reddit/mock";
import { ingestConversation } from "@/lib/ingest";
import { qualifyConversation } from "@/lib/ai/analyze";
import { generateAction, approveAction } from "@/lib/actions";
import { importReplyManually } from "@/lib/monitoring";
import { recordSignup } from "@/lib/attribution";
import { setSetting, SETTING_KEYS } from "@/lib/settings";
import { MOCK_CONVERSATIONS, OUR_MOCK_USERNAME } from "@/lib/reddit/mockData";
import { resetDb } from "./helpers";

describe("full permission workflow (heuristic)", () => {
  beforeEach(async () => {
    await resetDb();
    env.ANTHROPIC_API_KEY = "";
    setProviderForTests(new MockProvider());
    await setSetting(SETTING_KEYS.redditOurUsername, OUR_MOCK_USERNAME);
    await setSetting(SETTING_KEYS.waitlistUrl, "https://foler.co/waitlist");
    await prisma.communityConfig.create({
      data: { name: "tressless", allowedActions: ["HELP", "ENGAGE", "FOLLOW_UP", "INTRODUCE_FOLER", "WAITLIST_INVITE"], minRelevanceScore: 0 },
    });
  });
  afterEach(() => setProviderForTests(null));

  it("scenario 4 thread walks ENGAGE/permission-ask -> intro -> waitlist -> signup", async () => {
    // Scenario 4: we already helped once; they asked "is there anything that does this automatically?"
    const c4 = MOCK_CONVERSATIONS[3];
    // Start from the pre-engagement state: post + our helpful comment + their question
    const r = await ingestConversation(c4.post, c4.comments, "MOCK");
    const convo = () => prisma.conversation.findUniqueOrThrow({ where: { id: r.conversationId } });

    // First analysis marks the conversation FOLER_RELEVANCE_DETECTED (relevance >= 70)
    await qualifyConversation(r.conversationId);
    const st1 = (await convo()).permissionState;
    expect(["FOLER_RELEVANCE_DETECTED", "NO_FOLER_MENTION"]).toContain(st1);

    const a1 = await generateAction(r.conversationId);
    expect(a1).toBeTruthy();
    // Either an ENGAGE or a permission-ask INTRODUCE_FOLER; neither may contain FOLĒR
    expect(a1!.proposedResponse).not.toMatch(/fol[ēe]r/i);
    if (a1!.type === "ENGAGE") {
      // Post it (helpful engage), then simulate their reply asking what we do,
      // which should let the next INTRODUCE_FOLER be a permission ask.
      await approveAction(a1!.id, { by: "test" });
      await importReplyManually(r.conversationId, { author: "mock_device_dan", content: "thanks! do you know any tool that does this automatically?" });
    } else {
      await approveAction(a1!.id, { by: "test" });
    }
    let convoState = await convo();
    if (a1!.type === "INTRODUCE_FOLER") {
      expect(convoState.permissionState).toBe("PERMISSION_REQUESTED");
      // They grant permission
      await importReplyManually(r.conversationId, { author: "mock_device_dan", content: "Sure, what are you working on?" });
    } else {
      // After our ENGAGE reply above and their inbound, drive a permission ask
      const a2 = await generateAction(r.conversationId);
      expect(a2).toBeTruthy();
      if (a2!.type === "INTRODUCE_FOLER") {
        expect(a2!.proposedResponse).not.toMatch(/fol[ēe]r/i);
        await approveAction(a2!.id, { by: "test" });
        await importReplyManually(r.conversationId, { author: "mock_device_dan", content: "Sure, what are you working on?" });
      } else {
        await approveAction(a2!.id, { by: "test" });
        await importReplyManually(r.conversationId, { author: "mock_device_dan", content: "What are you working on then?" });
      }
    }

    // Now they granted permission; generate the introduction
    convoState = await convo();
    const introAction = await generateAction(r.conversationId);
    expect(introAction).toBeTruthy();
    expect(introAction!.type).toBe("INTRODUCE_FOLER");
    await approveAction(introAction!.id, { by: "test" });
    convoState = await convo();
    expect(convoState.permissionState).toBe("FOLER_INTRODUCED");

    // They express interest
    await importReplyManually(r.conversationId, { author: "mock_device_dan", content: "That sounds great, where can I sign up?" });
    const inviteAction = await generateAction(r.conversationId);
    expect(inviteAction).toBeTruthy();
    expect(inviteAction!.type).toBe("WAITLIST_INVITE");
    expect(inviteAction!.proposedResponse).toContain("https://foler.co/waitlist");
    expect(inviteAction!.proposedResponse).toContain("lead_id=");
    await approveAction(inviteAction!.id, { by: "test" });
    convoState = await convo();
    expect(convoState.permissionState).toBe("WAITLIST_INVITED");
    const conv = await prisma.conversion.findFirst({ where: { leadId: r.leadId } });
    expect(conv).toBeTruthy();
    expect(conv!.invitedAt).toBeTruthy();

    // Signup via attribution
    await recordSignup({ leadId: r.leadId, conversationId: r.conversationId, source: "reddit-self-reported" });
    convoState = await convo();
    expect(convoState.stage).toBe("WAITLIST_SIGNUP");
    const conv2 = await prisma.conversion.findFirst({ where: { leadId: r.leadId } });
    expect(conv2!.signedUpAt).toBeTruthy();
  });
});
