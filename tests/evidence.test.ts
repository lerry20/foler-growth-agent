import { describe, expect, it } from "vitest";
import { quoteAppears, quoteDenies, validateStruggles } from "@/lib/insights/evidence";
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

  it("drops a tag whose quote denies the problem", () => {
    const text =
      "I'll also note i haven't noticed any side effects but i also haven't seen any improvement in hair. " +
      "Thankfully, I didn't experience any noticeable side effects. " +
      "17 months, and i had great results and no side effects at all. " +
      "I had to stop fin due to side effects.";
    const r = validateStruggles(
      [
        { tag: "SIDE_EFFECTS", quote: "i haven't noticed any side effects but i also haven't seen any improvement in hair" },
        { tag: "SIDE_EFFECTS", quote: "Thankfully, I didn't experience any noticeable side effects" },
        { tag: "SIDE_EFFECTS", quote: "i had great results and no side effects at all" },
        { tag: "UNCERTAINTY_IF_WORKING", quote: "i also haven't seen any improvement in hair" },
      ],
      text,
    );
    expect(r.tags).toEqual(["UNCERTAINTY_IF_WORKING"]);
    expect(r.dropped.filter((d) => d.why === "quote denies the problem")).toHaveLength(3);
    expect(validateStruggles([{ tag: "SIDE_EFFECTS", quote: "I had to stop fin due to side effects" }], text).tags).toEqual(["SIDE_EFFECTS"]);
  });
});

describe("quoteDenies", () => {
  it("recognises negated side effects but not real ones", () => {
    expect(quoteDenies("SIDE_EFFECTS", "no side effects so far")).toBe(true);
    expect(quoteDenies("SIDE_EFFECTS", "zero sides after a year")).toBe(true);
    expect(quoteDenies("SIDE_EFFECTS", "9 months on morr f, erectile dysfunction")).toBe(false);
    expect(quoteDenies("SIDE_EFFECTS", "the side effects are killing my libido")).toBe(false);
    expect(quoteDenies("COST", "I can afford it but is it worth it")).toBe(true);
    expect(quoteDenies("COST", "I can't afford private derms")).toBe(false);
  });
});

describe("detectStruggles (keyword fallback)", () => {
  const tags = (t: string) => detectStruggles(t).map((e) => e.tag);

  it("tags UNCERTAINTY_IF_WORKING only for explicit efficacy doubt on a treatment", () => {
    expect(tags("Six months on topical min and I honestly can't tell if it's doing anything.")).toContain("UNCERTAINTY_IF_WORKING");
    expect(tags("Is fin actually working for anyone at 0.5mg?")).toContain("UNCERTAINTY_IF_WORKING");
    expect(tags("I've been on finasteride for like 5 months, and it's really hard to know for sure what effect it's had.")).toContain("UNCERTAINTY_IF_WORKING");
  });
  it("a known bad outcome is TIME_TO_RESULTS (no / disappointing results), not uncertainty", () => {
    const t = tags("Been on fin for a year, no visible improvement at all.");
    expect(t).toContain("TIME_TO_RESULTS");
    expect(t).not.toContain("UNCERTAINTY_IF_WORKING");
    expect(tags("A year on topical min and I didn't experience any results.")).toContain("TIME_TO_RESULTS");
    expect(tags("What should I expect from finasteride?")).toEqual(["TIME_TO_RESULTS"]);
    expect(tags("Is my dread shed lasting too long? 9 weeks in and no sign of it slowing.")).toContain("TIME_TO_RESULTS");
    expect(tags("Been on min for 2 years, fin for 10 months, still getting thinner.")).toContain("TIME_TO_RESULTS");
    expect(tags("Is this a shed or has the fin stopped working?")).toContain("TIME_TO_RESULTS");
    expect(tags("Tried topical for a year and a half, researched that I am probably a non-responder.")).toContain("TIME_TO_RESULTS");
  });
  it("does not tag TIME_TO_RESULTS for 'not working' about something other than the treatment", () => {
    expect(tags("It feels like the connection between my brain and my penis isn't working.")).not.toContain("TIME_TO_RESULTS");
  });
  it("tags PRODUCT_CHOICE for the person's own treatment decision", () => {
    expect(tags("Oral vs topical minoxidil")).toEqual(["PRODUCT_CHOICE"]);
    expect(tags("Should I switch to dut? Been on fin 10 months.")).toContain("PRODUCT_CHOICE");
    expect(tags("Can anyone advise me on how to use and layer these different treatments?")).toContain("PRODUCT_CHOICE");
    expect(tags("I'm basically deciding between foam and PG-free liquid.")).toContain("PRODUCT_CHOICE");
    expect(tags("If so, what helped you, or is there anything you would recommend trying?")).toContain("PRODUCT_CHOICE");
    expect(tags("I was thinking to gradually switch to oral min.")).toContain("PRODUCT_CHOICE");
  });
  it("does not tag PRODUCT_CHOICE for advice aimed at others or a satisfied report", () => {
    expect(tags("If you are thinking about starting minoxidil, just buy it and start.")).not.toContain("PRODUCT_CHOICE");
    expect(tags("Definitely worth it and I can't wait to see more progress.")).not.toContain("PRODUCT_CHOICE");
    expect(tags("So I decided to switch from finasteride to dutasteride and here is my experience.")).not.toContain("PRODUCT_CHOICE");
  });
  it("a side-effect mention is not a side-effect struggle", () => {
    expect(tags("There's a chance of sexual dysfunction and severe depression with fin.")).toEqual([]);
    expect(tags("Side effects wise everything is going smooth so far.")).not.toContain("SIDE_EFFECTS");
    expect(tags("Any ways to minimise side effects before I start?")).not.toContain("SIDE_EFFECTS");
    expect(tags("Did any of you get side effects on oral min?")).not.toContain("SIDE_EFFECTS");
    expect(tags("No side effects at all the first month. Month three though my libido crashed and I couldn't perform.")).toContain("SIDE_EFFECTS");
  });
  it("stress as a cause or a personality trait is not emotional distress", () => {
    expect(tags("He thinks it is due to stress and anxiety.")).not.toContain("EMOTIONAL_DISTRESS");
    expect(tags("I'm generally an anxious person and haven't had any hairloss this intense before, so I am unsure what's causing it.")).not.toContain("EMOTIONAL_DISTRESS");
    expect(tags("I am incredibly anxious about taking an oral pill systemically.")).toContain("EMOTIONAL_DISTRESS");
  });
  it("keeps the quote window around the matched phrase in a very long sentence", () => {
    const long = "Now I know I'm going to get told off for assuming things since I'm not a doctor and should just listen to mine, but he told me that my results are all within range and appear normal to him, so there is no metabolic reason for the hairloss and I should just wait it out and see what happens.";
    const e = detectStruggles(long).find((x) => x.tag === "DIAGNOSIS_UNCLEAR");
    expect(e?.quote).toMatch(/no metabolic reason for the hairloss/);
    expect(e!.quote.length).toBeLessThanOrEqual(220);
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
