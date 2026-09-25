import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { applyGates, outboundPreflight } from "@/lib/gates";
import { ingestConversation } from "@/lib/ingest";
import { MOCK_CONVERSATIONS, OUR_MOCK_USERNAME } from "@/lib/reddit/mockData";
import { setSetting, SETTING_KEYS } from "@/lib/settings";
import { resetDb } from "./helpers";
import type { Analysis } from "@/lib/ai/types";

const baseAnalysis = (over: Partial<Analysis> = {}): Analysis => ({
  problem: "p",
  hair_concern: "",
  treatment: "",
  treatment_duration: "",
  intent: "OTHER",
  foler_relevance: 50,
  conversation_opportunity: 50,
  conversion_potential: 50,
  recommended_action: "ENGAGE",
  should_mention_foler: true,
  permission_signal: "NONE",
  reason: "r",
  suggested_response: "Here is advice. Try FOLĒR it is great. More advice.",
  scores: { problem_relevance: 10, measurement_intent: 10, treatment_journey: 0, conversation_opportunity: 10, product_intent: 0 },
  ...over,
});

describe("applyGates", () => {
  it("forces should_mention_foler false under NO_FOLER_MENTION and strips FOLĒR sentences", () => {
    const { analysis, blocked } = applyGates(baseAnalysis(), {
      subreddit: "tressless",
      permissionState: "NO_FOLER_MENTION",
      waitlistUrl: "https://x.co",
    });
    expect(analysis.should_mention_foler).toBe(false);
    expect(analysis.suggested_response).not.toMatch(/fol[ēe]r/i);
    expect(blocked.length).toBeGreaterThan(0);
  });

  it("no outbound yet -> INTRODUCE_FOLER downgrades to HELP", () => {
    const { analysis, blocked } = applyGates(
      baseAnalysis({ recommended_action: "INTRODUCE_FOLER", suggested_response: "I'm building something for this. Try FOLĒR." }),
      { subreddit: "tressless", permissionState: "PERMISSION_GRANTED", waitlistUrl: "https://x.co", hasOutbound: false },
    );
    expect(analysis.recommended_action).toBe("HELP");
    expect(analysis.should_mention_foler).toBe(false);
    expect(analysis.suggested_response).not.toMatch(/fol[ēe]r|building something/i);
    expect(blocked.join(" ")).toContain("Help first");
  });

  it("downgrades INTRODUCE_FOLER/WAITLIST_INVITE when community disallows intro", () => {
    const { analysis } = applyGates(baseAnalysis({ recommended_action: "WAITLIST_INVITE", permission_signal: "INTEREST_EXPRESSED" }), {
      subreddit: "tressless",
      permissionState: "FOLER_INTRODUCED",
      waitlistUrl: "https://x.co",
      hasOutbound: true,
      community: { folerIntroAllowed: false, dmAllowed: false, minRelevanceScore: 0, allowedActions: [] },
    });
    expect(analysis.recommended_action).toBe("FOLLOW_UP");
    expect(analysis.should_mention_foler).toBe(false);
  });
});

describe("outboundPreflight", () => {
  beforeEach(async () => {
    await resetDb();
    await setSetting(SETTING_KEYS.redditOurUsername, OUR_MOCK_USERNAME);
  });

  it("paused account -> not ok", async () => {
    const r = await ingestConversation(MOCK_CONVERSATIONS[0].post, MOCK_CONVERSATIONS[0].comments, "MOCK");
    await prisma.accountHealth.update({
      where: { id: "default" },
      data: { outboundPaused: true, pausedReason: "test", pausedUntil: new Date(Date.now() + 60000) },
    });
    const res = await outboundPreflight(r.conversationId, "HELP");
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toContain("paused");
  });

  it("pending action -> not ok", async () => {
    const r = await ingestConversation(MOCK_CONVERSATIONS[0].post, MOCK_CONVERSATIONS[0].comments, "MOCK");
    await prisma.action.create({
      data: { conversationId: r.conversationId, type: "HELP", status: "PROPOSED" },
    });
    const res = await outboundPreflight(r.conversationId, "HELP");
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toContain("pending action");
  });
});
