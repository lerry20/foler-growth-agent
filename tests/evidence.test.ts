import { describe, expect, it } from "vitest";
import { quoteAppears, validateStruggles } from "@/lib/insights/evidence";
import { detectStruggles } from "@/lib/insights/heuristicStruggles";

const POST = `Is my experience with finasteride normal?
I've been on finasteride for like 5 months, and it's really hard to know for sure what effect it's had.
Still shedding tens of hairs when I wash. Itchy scalp too. Should I add minoxidil?`;

describe("quoteAppears", () => {
  it("accepts verbatim quotes regardless of case/punctuation", () => {
    expect(quoteAppears("really hard to know for sure what effect it's had", POST)).toBe(true);
    expect(quoteAppears("REALLY HARD TO KNOW, for sure, what effect its had", POST)).toBe(true);
  });
  it("tolerates ellipses / a dropped word", () => {
    expect(quoteAppears("been on finasteride for 5 months ... hard to know what effect it's had", POST)).toBe(true);
  });
  it("rejects paraphrases and quotes not in the text", () => {
    expect(quoteAppears("unsure whether the treatment is working", POST)).toBe(false);
    expect(quoteAppears("I cannot afford the dermatologist", POST)).toBe(false);
  });
  it("rejects quotes shorter than three words", () => {
    expect(quoteAppears("finasteride", POST)).toBe(false);
    expect(quoteAppears("itchy scalp", POST)).toBe(false);
  });
});

describe("validateStruggles", () => {
  it("keeps only known tags backed by a real quote, capped at 3", () => {
    const r = validateStruggles(
      [
        { tag: "UNCERTAINTY_IF_WORKING", quote: "really hard to know for sure what effect it's had" },
        { tag: "PRODUCT_CHOICE", quote: "Should I add minoxidil?" },
        { tag: "MEASUREMENT_TRACKING", quote: "I take photos every week" },
        { tag: "COST", quote: "" },
        { tag: "MADE_UP_TAG", quote: "Still shedding tens of hairs when I wash" },
        { tag: "SIDE_EFFECTS", quote: "Itchy scalp too. Should I add" },
        { tag: "EMOTIONAL_DISTRESS", quote: "Still shedding tens of hairs when I wash" },
      ],
      POST,
    );
    expect(r.tags).toEqual(["UNCERTAINTY_IF_WORKING", "PRODUCT_CHOICE", "SIDE_EFFECTS"]);
    expect(r.evidence[0].quote).toBe("really hard to know for sure what effect it's had");
    expect(r.dropped.map((d) => d.tag)).toEqual(["MEASUREMENT_TRACKING", "COST", "MADE_UP_TAG"]);
  });
  it("drops OTHER when a real tag survives, keeps it when alone", () => {
    expect(
      validateStruggles(
        [{ tag: "OTHER", quote: "Still shedding tens of hairs" }, { tag: "PRODUCT_CHOICE", quote: "Should I add minoxidil" }],
        POST,
      ).tags,
    ).toEqual(["PRODUCT_CHOICE"]);
    expect(validateStruggles([{ tag: "OTHER", quote: "Still shedding tens of hairs" }], POST).tags).toEqual(["OTHER"]);
  });
  it("handles missing/garbage input", () => {
    expect(validateStruggles(undefined, POST).tags).toEqual([]);
    expect(validateStruggles([{}, { tag: 3, quote: null }], POST).tags).toEqual([]);
  });
});

describe("detectStruggles (keyword fallback)", () => {
  const tags = (t: string) => detectStruggles(t).map((e) => e.tag);

  it("tags UNCERTAINTY_IF_WORKING only for explicit efficacy doubt on a treatment", () => {
    expect(tags("Six months on topical min and I honestly can't tell if it's doing anything.")).toContain("UNCERTAINTY_IF_WORKING");
    expect(tags("Been on fin for a year, no visible improvement at all.")).toContain("UNCERTAINTY_IF_WORKING");
    expect(tags("Is fin actually working for anyone at 0.5mg?")).toContain("UNCERTAINTY_IF_WORKING");
  });
  it("does not tag it for generic mentions of working / progress / difference", () => {
    expect(tags("Hair regrowth products to use? Anything else I should add to my stack? Working full time now.")).not.toContain("UNCERTAINTY_IF_WORKING");
    expect(tags("9 months on Morr F, hair wise things have improved but the ED is a real difference in my life.")).not.toContain("UNCERTAINTY_IF_WORKING");
    expect(tags("14M, sudden diffuse thinning after weight loss. Is this normal? No progress on figuring it out.")).not.toContain("UNCERTAINTY_IF_WORKING");
    expect(tags("Considering topical minoxidil and topical finasteride, does anyone have experience with the combo?")).not.toContain("UNCERTAINTY_IF_WORKING");
  });
  it("assigns the right tags to the mis-tagged cases and quotes the sentence", () => {
    const stack = detectStruggles("Hair regrowth products to use? Anything else to use with min and fin?");
    expect(stack.map((e) => e.tag)).toEqual(["PRODUCT_CHOICE"]);
    expect(stack[0].quote).toBe("Anything else to use with min and fin?");

    expect(tags("9 months on Morr F. Hair wise things have improved but I have ED and low libido now.")).toEqual(["SIDE_EFFECTS"]);
    expect(tags("14M and my hair suddenly got thin after weight loss and being sick. Is this normal or am I balding?")).toEqual(["DIAGNOSIS_UNCLEAR"]);
    expect(tags("Should I start minoxidil? The idea of applying it every day for the rest of my life gives me anxiety and it's expensive.")).toEqual(
      expect.arrayContaining(["PRODUCT_CHOICE", "CONSISTENCY_ADHERENCE", "EMOTIONAL_DISTRESS"]),
    );
  });
  it("returns nothing for text without a struggle", () => {
    expect(tags("Just sharing my 12 month before and after, super happy with the results!")).toEqual([]);
  });
  it("never returns more than three tags", () => {
    expect(
      detectStruggles(
        "Can't tell if fin is working, hard to compare photos, side effects too, can't afford derm, conflicting advice everywhere, so anxious.",
      ).length,
    ).toBeLessThanOrEqual(3);
  });
});
