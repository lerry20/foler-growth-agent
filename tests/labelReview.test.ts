import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ingestConversation } from "@/lib/ingest";
import { setSetting, SETTING_KEYS } from "@/lib/settings";
import { MOCK_CONVERSATIONS, OUR_MOCK_USERNAME } from "@/lib/reddit/mockData";
import { applyLabelReviews, scoreLabels, reviewLabel, clearLabelReview } from "@/lib/insights/labelReview";
import { computeInsights } from "@/lib/insights/aggregate";
import { resetDb } from "./helpers";

describe("applyLabelReviews", () => {
  const engine = [
    { tag: "SIDE_EFFECTS" as const, quote: "no side effects so far" },
    { tag: "COST" as const, quote: "can't afford dut" },
  ];

  it("keeps engine labels untouched without reviews", () => {
    const r = applyLabelReviews(engine, []);
    expect(r.tags).toEqual(["SIDE_EFFECTS", "COST"]);
    expect(r.human).toBe(false);
  });

  it("drops a label judged wrong, keeps one judged right, adds one the engine missed", () => {
    const r = applyLabelReviews(engine, [
      { tag: "SIDE_EFFECTS", verdict: "WRONG" },
      { tag: "COST", verdict: "RIGHT" },
      { tag: "EMOTIONAL_DISTRESS", verdict: "MISSED" },
    ]);
    expect(r.tags).toEqual(["COST", "EMOTIONAL_DISTRESS"]);
    expect(r.evidence.find((e) => e.tag === "COST")).toEqual({ tag: "COST", quote: "can't afford dut", human: "confirmed" });
    expect(r.evidence.find((e) => e.tag === "EMOTIONAL_DISTRESS")).toEqual({ tag: "EMOTIONAL_DISTRESS", quote: "", human: "added" });
    expect(r.human).toBe(true);
  });

  it("ignores a MISSED verdict for a tag the engine already gave, and unknown tags", () => {
    const r = applyLabelReviews(engine, [
      { tag: "COST", verdict: "MISSED" },
      { tag: "NOT_A_TAG", verdict: "MISSED" },
    ]);
    expect(r.tags).toEqual(["SIDE_EFFECTS", "COST"]);
  });
});

describe("scoreLabels", () => {
  it("computes precision over judged engine labels and lists the worst tags first", () => {
    const s = scoreLabels([
      { tag: "SIDE_EFFECTS", verdict: "WRONG" },
      { tag: "SIDE_EFFECTS", verdict: "WRONG" },
      { tag: "SIDE_EFFECTS", verdict: "RIGHT" },
      { tag: "COST", verdict: "RIGHT" },
      { tag: "EMOTIONAL_DISTRESS", verdict: "MISSED" },
    ]);
    expect(s).toMatchObject({ reviewed: 5, right: 2, wrong: 2, missed: 1, precision: 0.5 });
    expect(s.perTag[0]).toEqual({ tag: "SIDE_EFFECTS", right: 1, wrong: 2, missed: 0 });
  });

  it("has null precision with nothing judged", () => {
    expect(scoreLabels([{ tag: "COST", verdict: "MISSED" }]).precision).toBeNull();
  });
});

describe("label review in the database", () => {
  beforeEach(async () => {
    await resetDb();
    await setSetting(SETTING_KEYS.redditOurUsername, OUR_MOCK_USERNAME);
  });

  async function realThread() {
    const c = MOCK_CONVERSATIONS[0];
    const real = { ...c.post, id: "realpost1", author: "real_op" };
    const { conversationId } = await ingestConversation(real, c.comments.map((k) => ({ ...k, id: `r_${k.id}`, postId: real.id })), "PUBLIC_WEB");
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastAnalyzedAt: new Date(),
        analysisProvider: "heuristic",
        struggleTags: ["SIDE_EFFECTS", "COST"],
        struggleEvidence: [
          { tag: "SIDE_EFFECTS", quote: "thankfully no side effects" },
          { tag: "COST", quote: "cannot afford the brand name" },
        ],
      },
    });
    return conversationId;
  }

  it("snapshots the engine's quote, removes a wrong label from Insights, adds a missed one, and can be undone", async () => {
    const id = await realThread();
    const before = await computeInsights();
    expect(before.problems.map((p) => p.tag).sort()).toEqual(["COST", "SIDE_EFFECTS"]);

    const wrong = await reviewLabel(id, "SIDE_EFFECTS", "WRONG");
    expect(wrong.quote).toBe("thankfully no side effects");
    expect(wrong.modelProvider).toBe("heuristic");
    await reviewLabel(id, "COST", "RIGHT");
    await reviewLabel(id, "EMOTIONAL_DISTRESS", "MISSED");

    const after = await computeInsights();
    expect(after.problems.map((p) => p.tag).sort()).toEqual(["COST", "EMOTIONAL_DISTRESS"]);
    expect(after.problems.find((p) => p.tag === "COST")?.examples[0]).toMatchObject({ quote: "cannot afford the brand name", provider: "human", human: "confirmed" });
    expect(after.problems.find((p) => p.tag === "EMOTIONAL_DISTRESS")?.examples[0]).toMatchObject({ quote: "", human: "added" });
    expect(after.methodology.voices.labelsChecked).toBe(3);

    // Changing your mind overwrites, never duplicates.
    await reviewLabel(id, "SIDE_EFFECTS", "RIGHT");
    expect(await prisma.struggleReview.count({ where: { conversationId: id, tag: "SIDE_EFFECTS" } })).toBe(1);

    await clearLabelReview(id, "EMOTIONAL_DISTRESS");
    await clearLabelReview(id, "SIDE_EFFECTS");
    const undone = await computeInsights();
    expect(undone.problems.map((p) => p.tag).sort()).toEqual(["COST", "SIDE_EFFECTS"]);
  });

  it("refuses verdicts that do not match what the engine said", async () => {
    const id = await realThread();
    await expect(reviewLabel(id, "COST", "MISSED")).rejects.toThrow(/already gave/);
    await expect(reviewLabel(id, "TIME_TO_RESULTS", "WRONG")).rejects.toThrow(/did not give/);
  });
});
