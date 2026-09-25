import { describe, expect, it } from "vitest";
import { groupThemes, groupStruggles, countBy, isoWeek, normalizeTreatments, type InsightRow } from "@/lib/insights/aggregate";

const row = (over: Partial<InsightRow>): InsightRow => ({
  id: "c1", leadId: "l1", subreddit: "tressless", title: "t", url: "u",
  createdAt: new Date("2025-01-06T12:00:00Z"), postedAt: new Date("2025-01-06T12:00:00Z"), commentCount: 0, analyzed: true,
  problemTheme: "", struggleTags: [], unmetNeed: "", intent: "", hairConcern: "", treatment: "",
  ...over,
});

describe("insights aggregation helpers", () => {
  it("normalizes theme by trim/lowercase and drops empty", () => {
    const themes = groupThemes([
      row({ problemTheme: "  Unsure If Working " }),
      row({ problemTheme: "unsure if working" }),
      row({ problemTheme: "" }),
      row({ id: "c2", problemTheme: "cost of treatment" }),
    ]);
    expect(themes.map((t) => t.theme)).toEqual(["unsure if working", "cost of treatment"]);
    expect(themes[0].count).toBe(2);
  });

  it("computes share over themed rows and caps examples at 3", () => {
    const rows = [
      row({ id: "a", problemTheme: "x" }), row({ id: "b", problemTheme: "x" }),
      row({ id: "c", problemTheme: "x" }), row({ id: "d", problemTheme: "x" }),
      row({ id: "e", problemTheme: "y" }),
    ];
    const themes = groupThemes(rows);
    expect(themes[0].share).toBe(80);
    expect(themes[0].examples).toHaveLength(3);
  });

  it("counts struggle tags across rows", () => {
    const struggles = groupStruggles([
      row({ struggleTags: ["COST", "SIDE_EFFECTS"] }),
      row({ struggleTags: ["COST"] }),
      row({ struggleTags: [] }),
    ]);
    expect(struggles[0]).toMatchObject({ tag: "COST", label: "Cost", count: 2 });
    expect(struggles.find((s) => s.tag === "SIDE_EFFECTS")?.count).toBe(1);
  });

  it("countBy skips empty keys and sorts desc", () => {
    const out = countBy([
      row({ treatment: "Minoxidil" }), row({ treatment: "Finasteride" }),
      row({ treatment: "Minoxidil" }), row({ treatment: "  " }),
    ], (r) => r.treatment);
    expect(out).toEqual([{ key: "Minoxidil", count: 2 }, { key: "Finasteride", count: 1 }]);
  });

  it("isoWeek buckets dates into ISO weeks", () => {
    expect(isoWeek(new Date("2025-01-06T00:00:00Z"))).toBe("2025-W02");
    expect(isoWeek(new Date("2025-01-01T00:00:00Z"))).toBe("2025-W01");
  });
});

describe("normalizeTreatments", () => {
  it("buckets free-text treatments into canonical labels", () => {
    expect(normalizeTreatments("Oral finasteride 1mg + oral minoxidil 2.5mg")).toEqual(["Finasteride / dutasteride", "Oral minoxidil"]);
    expect(normalizeTreatments("topical Minoxidil (failed), now prescribed oral Minoxidil 1mg")).toEqual(["Oral minoxidil", "Topical minoxidil"]);
    expect(normalizeTreatments("none (considering oral minoxidil)")).toEqual(["No treatment yet"]);
    expect(normalizeTreatments("")).toEqual([]);
    expect(normalizeTreatments("prayer")).toEqual(["Other / unspecified"]);
  });
});
