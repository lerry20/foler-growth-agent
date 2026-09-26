import { describe, expect, it } from "vitest";
import { labelPrompt } from "@/lib/voices/struggles";
import { validateStruggles } from "@/lib/insights/evidence";
import type { VoiceDraft } from "@/lib/voices/split";

const commenter: VoiceDraft = {
  author: "alice",
  role: "COMMENTER",
  messageIds: ["m2"],
  text: "Same here, 8 months on fin and I honestly can't tell if anything changed.",
  wordCount: 14,
};

const ctx = { title: "Is fin working?", subreddit: "tressless", opText: "I'm getting brain fog on finasteride.", corrections: "" };

describe("per-voice struggle labelling", () => {
  it("shows a commenter the original post as context only, never as their words", () => {
    const p = labelPrompt(commenter, ctx);
    expect(p).toContain("context only");
    expect(p).toContain("COMMENTER");
    expect(p).toContain(commenter.text);
  });

  it("omits the original-post block when labelling the poster", () => {
    const p = labelPrompt({ ...commenter, author: "op", role: "OP" }, ctx);
    expect(p).not.toContain("context only");
    expect(p).toContain("ORIGINAL POSTER");
  });

  it("a quote lifted from the original post is not evidence for the commenter", () => {
    const r = validateStruggles(
      [
        { tag: "SIDE_EFFECTS", quote: "getting brain fog on finasteride" },
        { tag: "UNCERTAINTY_IF_WORKING", quote: "can't tell if anything changed" },
      ],
      commenter.text,
    );
    expect(r.tags).toEqual(["UNCERTAINTY_IF_WORKING"]);
    expect(r.dropped[0]).toMatchObject({ tag: "SIDE_EFFECTS", why: "quote not found in thread" });
  });
});
