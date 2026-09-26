import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ingestConversation } from "@/lib/ingest";
import { setSetting, SETTING_KEYS } from "@/lib/settings";
import { MOCK_CONVERSATIONS, OUR_MOCK_USERNAME } from "@/lib/reddit/mockData";
import { reviewVoice, clearReview, scoreGate, effective, isCounted } from "@/lib/voices/review";
import { computeInsights } from "@/lib/insights/aggregate";
import { resetDb } from "./helpers";

describe("scoreGate", () => {
  it("scores the model's gate against human verdicts, ignoring voices the model never decided", () => {
    const s = scoreGate([
      { speaksAbout: "OWN_CASE", inScope: true, modelSpeaksAbout: "OWN_CASE", modelInScope: true },
      { speaksAbout: "OWN_CASE", inScope: true, modelSpeaksAbout: "ADVICE_ONLY", modelInScope: null },
      { speaksAbout: "ADVICE_ONLY", inScope: false, modelSpeaksAbout: "OWN_CASE", modelInScope: true },
      { speaksAbout: "ADVICE_ONLY", inScope: false, modelSpeaksAbout: "OWN_CASE", modelInScope: true },
      { speaksAbout: "META", inScope: false, modelSpeaksAbout: "META", modelInScope: false },
      { speaksAbout: "OWN_CASE", inScope: true, modelSpeaksAbout: null, modelInScope: null },
    ]);
    expect(s.reviewed).toBe(6);
    expect(s.compared).toBe(5);
    expect(s.agree).toBe(2);
    expect(s.accuracy).toBeCloseTo(0.4);
    expect(s.counted).toEqual({ tp: 1, fp: 2, fn: 1, precision: 1 / 3, recall: 0.5 });
    expect(s.confusions[0]).toEqual({ model: "OWN_CASE", human: "ADVICE_ONLY", count: 2 });
  });

  it("returns nulls, not NaN, with nothing to compare", () => {
    const s = scoreGate([]);
    expect(s.accuracy).toBeNull();
    expect(s.counted.precision).toBeNull();
    expect(s.counted.recall).toBeNull();
  });
});

describe("effective verdict", () => {
  it("human beats model; own case outside hair/scalp is not counted", () => {
    const model = { speaksAbout: "OWN_CASE" as const, inScope: true, review: null };
    expect(effective(model)).toEqual({ speaksAbout: "OWN_CASE", inScope: true, source: "model" });
    expect(isCounted(effective(model))).toBe(true);
    const overridden = { ...model, review: { speaksAbout: "ADVICE_ONLY" as const, inScope: false } };
    expect(effective(overridden).source).toBe("human");
    expect(isCounted(effective(overridden))).toBe(false);
    expect(isCounted({ speaksAbout: "OWN_CASE", inScope: false })).toBe(false);
    expect(effective({ speaksAbout: null, inScope: null, review: null }).source).toBe("none");
  });
});

describe("human review in the database", () => {
  beforeEach(async () => {
    await resetDb();
    await setSetting(SETTING_KEYS.redditOurUsername, OUR_MOCK_USERNAME);
  });

  it("stores the verdict with a snapshot of the model, overrides Insights, and can be undone", async () => {
    const c = MOCK_CONVERSATIONS[0];
    const real = { ...c.post, id: "realpost1", author: "real_op" };
    const { conversationId } = await ingestConversation(real, c.comments.map((k) => ({ ...k, id: `r_${k.id}`, postId: real.id })), "PUBLIC_WEB");
    const voices = await prisma.voice.findMany({ where: { conversationId } });
    const op = voices.find((v) => v.role === "OP")!;
    const commenter = voices.find((v) => v.role === "COMMENTER")!;

    // Model wrongly counted the commenter as own case; OP is still undecided.
    await prisma.voice.update({
      where: { id: commenter.id },
      data: { speaksAbout: "OWN_CASE", inScope: true, gatedAt: new Date(), gateProvider: "anthropic", gateWhy: "says 'me too'" },
    });
    let m = (await computeInsights()).methodology.voices;
    expect(m).toMatchObject({ ownCase: 1, humanChecked: 0 });
    expect(m.pending).toBe(voices.length - 1);

    const r = await reviewVoice(commenter.id, { speaksAbout: "ADVICE_ONLY", inScope: false });
    expect(r.modelSpeaksAbout).toBe("OWN_CASE");
    expect(r.modelInScope).toBe(true);
    await reviewVoice(op.id, { speaksAbout: "OWN_CASE", inScope: true });

    m = (await computeInsights()).methodology.voices;
    expect(m).toMatchObject({ ownCase: 1, ownCaseCommenters: 0, humanChecked: 2 });
    expect(m.pending).toBe(voices.length - 2);

    const score = scoreGate(await prisma.voiceReview.findMany());
    expect(score).toMatchObject({ reviewed: 2, compared: 1, agree: 0 });
    expect(score.counted).toMatchObject({ tp: 0, fp: 1, fn: 0 });

    // Changing one's mind keeps the original model snapshot.
    const again = await reviewVoice(commenter.id, { speaksAbout: "OWN_CASE", inScope: true });
    expect(again.modelSpeaksAbout).toBe("OWN_CASE");
    expect((await computeInsights()).methodology.voices.ownCase).toBe(2);

    await clearReview(commenter.id);
    expect(await prisma.voiceReview.count()).toBe(1);
    expect((await computeInsights()).methodology.voices.humanChecked).toBe(1);
  });
});
