import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ingestConversation } from "@/lib/ingest";
import { setSetting, SETTING_KEYS } from "@/lib/settings";
import { MOCK_CONVERSATIONS, OUR_MOCK_USERNAME } from "@/lib/reddit/mockData";
import { applyLabelReviews, scoreLabels, reviewLabel, clearLabelReview, correctionsText, reviewIntent, clearIntentReview, NO_STRUGGLE } from "@/lib/insights/labelReview";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { KNOWLEDGE_BASE_DEFAULTS } from "@/lib/settings";
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

describe("applyLabelReviews with corrections", () => {
  const evidence = [
    { tag: "UNCERTAINTY_IF_WORKING" as const, quote: "should I start fin or oral min" },
    { tag: "SIDE_EFFECTS" as const, quote: "thankfully no side effects" },
  ];

  it("a wrong label corrected to another tag is counted under that tag with the same quote", () => {
    const r = applyLabelReviews(evidence, [{ tag: "UNCERTAINTY_IF_WORKING", verdict: "WRONG", shouldBe: "PRODUCT_CHOICE" }]);
    expect(r.tags).toEqual(["SIDE_EFFECTS", "PRODUCT_CHOICE"]);
    expect(r.evidence.find((e) => e.tag === "PRODUCT_CHOICE")).toEqual({ tag: "PRODUCT_CHOICE", quote: "should I start fin or oral min", human: "corrected" });
  });

  it("a wrong label corrected to NONE counts nothing", () => {
    const r = applyLabelReviews(evidence, [{ tag: "SIDE_EFFECTS", verdict: "WRONG", shouldBe: NO_STRUGGLE }]);
    expect(r.tags).toEqual(["UNCERTAINTY_IF_WORKING"]);
  });

  it("never resurrects a tag the human also judged wrong, and never duplicates one the engine kept", () => {
    const r = applyLabelReviews(evidence, [
      { tag: "UNCERTAINTY_IF_WORKING", verdict: "WRONG", shouldBe: "SIDE_EFFECTS" },
      { tag: "SIDE_EFFECTS", verdict: "WRONG", shouldBe: "UNCERTAINTY_IF_WORKING" },
    ]);
    expect(r.tags).toEqual([]);
    const r2 = applyLabelReviews(evidence, [{ tag: "UNCERTAINTY_IF_WORKING", verdict: "WRONG", shouldBe: "SIDE_EFFECTS" }]);
    expect(r2.tags).toEqual(["SIDE_EFFECTS"]);
    expect(r2.evidence[0].human).toBeUndefined();
  });
});

describe("correctionsText", () => {
  it("turns wrong verdicts with quotes into worked examples and lands in the system prompt", () => {
    const text = correctionsText([
      { tag: "SIDE_EFFECTS", verdict: "WRONG", shouldBe: NO_STRUGGLE, quote: "thankfully no side effects", note: "he denies them" },
      { tag: "UNCERTAINTY_IF_WORKING", verdict: "WRONG", shouldBe: "PRODUCT_CHOICE", quote: "should I start fin or oral min", note: "" },
      { tag: "COST", verdict: "RIGHT", shouldBe: null, quote: "cannot afford", note: "" },
      { tag: "COST", verdict: "WRONG", shouldBe: null, quote: "", note: "" },
    ]);
    expect(text).toContain('"thankfully no side effects" → NOT SIDE_EFFECTS (Side effects); correct: NO struggle tag at all. Reviewer: he denies them');
    expect(text).toContain("correct: PRODUCT_CHOICE (Which product / protocol to choose)");
    expect(text).not.toContain("cannot afford");
    expect(text.split("\n")).toHaveLength(3);
    expect(buildSystemPrompt(KNOWLEDGE_BASE_DEFAULTS, text)).toContain("HUMAN-REVIEWED MISTAKES TO AVOID");
    expect(buildSystemPrompt(KNOWLEDGE_BASE_DEFAULTS)).not.toContain("HUMAN-REVIEWED");
    expect(correctionsText([])).toBe("");
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
    expect(s.perTag[0]).toEqual({ tag: "SIDE_EFFECTS", right: 1, wrong: 2, missed: 0, shouldBe: {} });
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
    await expect(reviewLabel(id, "COST", "RIGHT", "SIDE_EFFECTS")).rejects.toThrow(/Only a wrong label/);
    await expect(reviewLabel(id, "COST", "WRONG", "COST")).rejects.toThrow(/Unknown correction/);
    await expect(reviewLabel(id, "COST", "WRONG", "BOGUS")).rejects.toThrow(/Unknown correction/);
  });

  it("stores what a wrong label should be, moves the quote to that tag in Insights, and scores it", async () => {
    const id = await realThread();
    const r = await reviewLabel(id, "SIDE_EFFECTS", "WRONG", NO_STRUGGLE);
    expect(r.shouldBe).toBe("NONE");
    await reviewLabel(id, "COST", "WRONG", "ACCESS_TO_CARE");

    const after = await computeInsights();
    expect(after.problems.map((p) => p.tag)).toEqual(["ACCESS_TO_CARE"]);
    expect(after.problems[0].examples[0]).toMatchObject({ quote: "cannot afford the brand name", provider: "human", human: "corrected" });

    const reviews = await prisma.struggleReview.findMany({ where: { conversationId: id } });
    const score = scoreLabels(reviews);
    expect(score.corrected).toBe(1);
    expect(score.perTag.find((t) => t.tag === "COST")?.shouldBe).toEqual({ ACCESS_TO_CARE: 1 });

    // Flipping back to RIGHT clears the correction.
    const back = await reviewLabel(id, "COST", "RIGHT");
    expect(back.shouldBe).toBeNull();
  });

  it("a corrected intent overrides the engine in Insights and keeps the engine's read", async () => {
    const id = await realThread();
    await prisma.lead.update({ where: { id: (await prisma.conversation.findUniqueOrThrow({ where: { id } })).leadId }, data: { intent: "UNCERTAINTY" } });
    const r = await reviewIntent(id, "PRODUCT_INTENT");
    expect(r.modelIntent).toBe("UNCERTAINTY");
    const intents = (await computeInsights()).intents;
    expect(intents.find((x) => x.key === "PRODUCT_INTENT")?.count).toBe(1);
    expect(intents.find((x) => x.key === "UNCERTAINTY")).toBeUndefined();
    await clearIntentReview(id);
    expect((await computeInsights()).intents.find((x) => x.key === "UNCERTAINTY")?.count).toBe(1);
  });
});
