import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { POST } from "@/app/api/waitlist/signup/route";
import { ingestConversation } from "@/lib/ingest";
import { MOCK_CONVERSATIONS } from "@/lib/reddit/mockData";
import { resetDb } from "./helpers";
import { buildWaitlistUrl, buildTrackedWaitlistUrl } from "@/lib/attribution";
import { setSetting } from "@/lib/settings";

function req(body: object, secret?: string) {
  return new Request("http://localhost/api/waitlist/signup", {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-webhook-secret": secret } : {}) },
    body: JSON.stringify(body),
  });
}

describe("attribution webhook", () => {
  beforeEach(async () => {
    await resetDb();
    env.ATTRIBUTION_WEBHOOK_SECRET = "testsecret";
  });

  it("correct secret -> Conversion.signedUpAt + stage WAITLIST_SIGNUP", async () => {
    const r = await ingestConversation(MOCK_CONVERSATIONS[0].post, MOCK_CONVERSATIONS[0].comments, "MOCK");
    const res = await POST(req({ lead_id: r.leadId, conversation_id: r.conversationId }, "testsecret"));
    expect(res.status).toBe(200);
    const conv = await prisma.conversion.findFirst({ where: { leadId: r.leadId } });
    expect(conv?.signedUpAt).toBeTruthy();
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: r.conversationId } });
    expect(convo.stage).toBe("WAITLIST_SIGNUP");
    expect(convo.permissionState).toBe("WAITLIST_SIGNUP");
  });

  it("wrong secret -> 401", async () => {
    const res = await POST(req({ lead_id: "x" }, "nope"));
    expect(res.status).toBe(401);
  });
});

describe("tracked waitlist url", () => {
  beforeEach(resetDb);

  it("default -> direct URL with attribution params", async () => {
    const url = await buildTrackedWaitlistUrl("https://foler.co/waitlist", {
      subreddit: "tressless", leadId: "l1", conversationId: "c1", campaign: "cmp",
    });
    expect(url).toContain("https://foler.co/waitlist");
    expect(url).toContain("lead_id=l1");
    expect(url).toContain("source=reddit");
    expect(buildWaitlistUrl("https://foler.co/waitlist?utm=x", { subreddit: "s", leadId: "l", conversationId: "c", campaign: "k" })).toContain("utm=x");
  });

  it("useRedirect=true -> goes through /api/waitlist/go", async () => {
    await setSetting("attribution.useRedirect", "true");
    env.APP_BASE_URL = "http://localhost:3000";
    const url = await buildTrackedWaitlistUrl("https://foler.co/waitlist", {
      subreddit: "tressless", leadId: "l1", conversationId: "c1", campaign: "cmp",
    });
    expect(url).toContain("http://localhost:3000/api/waitlist/go");
    expect(url).toContain("lead_id=l1");
    expect(url).toContain("target=");
  });
});
