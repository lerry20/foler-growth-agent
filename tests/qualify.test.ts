import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { ingestConversation } from "@/lib/ingest";
import { qualifyConversation } from "@/lib/ai/analyze";
import { setSetting, SETTING_KEYS } from "@/lib/settings";
import { MOCK_CONVERSATIONS, OUR_MOCK_USERNAME } from "@/lib/reddit/mockData";
import { resetDb } from "./helpers";

async function ingestAll() {
  const ids: string[] = [];
  for (const c of MOCK_CONVERSATIONS) {
    const r = await ingestConversation(c.post, c.comments, "MOCK");
    ids.push(r.conversationId);
  }
  return ids;
}

describe("heuristic qualification on mock scenarios", () => {
  beforeEach(async () => {
    await resetDb();
    env.ANTHROPIC_API_KEY = "";
    await setSetting(SETTING_KEYS.redditOurUsername, OUR_MOCK_USERNAME);
    await prisma.communityConfig.create({
      data: {
        name: "tressless",
        allowedActions: ["HELP", "ENGAGE", "FOLLOW_UP", "INTRODUCE_FOLER", "WAITLIST_INVITE"],
        promotionSensitivity: "HIGH",
        minRelevanceScore: 0,
      },
    });
    await prisma.communityConfig.create({
      data: {
        name: "HairlossResearch",
        allowedActions: ["HELP", "ENGAGE", "FOLLOW_UP", "INTRODUCE_FOLER", "WAITLIST_INVITE"],
        minRelevanceScore: 0,
      },
    });
  });

  it("scenario 1: generic shedding -> HELP or IGNORE, no FOLĒR, not HOT", async () => {
    const [id] = await ingestAll();
    const a = await qualifyConversation(id);
    expect(["HELP", "IGNORE"]).toContain(a.recommended_action);
    expect(a.should_mention_foler).toBe(false);
    const lead = await prisma.lead.findFirst();
    expect(lead!.category).not.toBe("HOT");
  });

  it("scenario 2: can't tell if minoxidil working -> HELP or ENGAGE, no FOLĒR", async () => {
    const ids = await ingestAll();
    const a = await qualifyConversation(ids[1]);
    expect(["HELP", "ENGAGE"]).toContain(a.recommended_action);
    expect(a.should_mention_foler).toBe(false);
    expect(a.suggested_response).not.toMatch(/fol[ēe]r/i);
  });

  it("scenario 3: how to measure density -> ENGAGE, no FOLĒR", async () => {
    const ids = await ingestAll();
    const a = await qualifyConversation(ids[2]);
    expect(a.recommended_action).toBe("ENGAGE");
    expect(a.suggested_response).not.toMatch(/fol[ēe]r/i);
  });

  it("scenario 4: looking for a tracking device -> ENGAGE/INTRODUCE_FOLER, no FOLĒR mention", async () => {
    const ids = await ingestAll();
    const a = await qualifyConversation(ids[3]);
    expect(["ENGAGE", "INTRODUCE_FOLER"]).toContain(a.recommended_action);
    expect(a.should_mention_foler).toBe(false);
    expect(a.suggested_response).not.toMatch(/fol[ēe]r/i);
  });

  it("scenario 5: interest expressed -> WAITLIST_INVITE with substituted URL; downgraded when URL empty", async () => {
    await setSetting(SETTING_KEYS.waitlistUrl, "https://foler.co/waitlist");
    const ids = await ingestAll();
    const a = await qualifyConversation(ids[4]);
    expect(a.recommended_action).toBe("WAITLIST_INVITE");
    expect(a.suggested_response).toContain("https://foler.co/waitlist");
    expect(a.suggested_response).toContain("source=reddit");
    expect(a.suggested_response).toMatch(/lead_id=[a-z0-9]+/i);

    // Empty waitlist URL downgrades to FOLLOW_UP
    await setSetting(SETTING_KEYS.waitlistUrl, "");
    const b = await qualifyConversation(ids[4], { force: true });
    expect(b.recommended_action).toBe("FOLLOW_UP");
    expect(b.blocked.join(" ")).toContain("Waitlist URL not configured");
  });

  it("scenario 6: already signed up -> WAITLIST_SIGNUP stage and Conversion row", async () => {
    const ids = await ingestAll();
    const a = await qualifyConversation(ids[5]);
    expect(a.permission_signal).toBe("ALREADY_SIGNED_UP");
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: ids[5] } });
    expect(convo.permissionState).toBe("WAITLIST_SIGNUP");
    expect(convo.stage).toBe("WAITLIST_SIGNUP");
    const conversion = await prisma.conversion.findFirst({ where: { conversationId: ids[5] } });
    expect(conversion?.signedUpAt).toBeTruthy();
  });
});
