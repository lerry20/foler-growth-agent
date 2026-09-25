import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { ingestConversation } from "@/lib/ingest";
import { setSetting, SETTING_KEYS } from "@/lib/settings";
import { MOCK_CONVERSATIONS, OUR_MOCK_USERNAME } from "@/lib/reddit/mockData";
import { splitVoices, type VoiceMessage } from "@/lib/voices/split";
import { gateVoice, gatePrompt } from "@/lib/voices/gate";
import { gateVoices, syncVoices } from "@/lib/voices/sync";
import { analyzeWithAnthropic } from "@/lib/ai/anthropic";
import { resetDb } from "./helpers";

vi.mock("@/lib/ai/anthropic", () => ({ analyzeWithAnthropic: vi.fn() }));

const t0 = new Date("2026-09-01T10:00:00Z");
const at = (m: number) => new Date(t0.getTime() + m * 60_000);

function msg(p: Partial<VoiceMessage> & { id: string; author: string; content: string }): VoiceMessage {
  return { postedAt: t0, direction: "INBOUND", isOriginalPost: false, ...p };
}

describe("splitVoices", () => {
  it("groups every inbound author into one voice, OP first, our account excluded", () => {
    const voices = splitVoices([
      msg({ id: "c1", author: "Helper", content: "Try dutasteride, it worked for a friend of mine really well.", postedAt: at(5) }),
      msg({ id: "p", author: "Op_User", content: "Six months on finasteride and I really cannot tell if it is doing anything.", isOriginalPost: true }),
      msg({ id: "c2", author: "op_user", content: "Thanks — I take it every morning, never missed a dose.", postedAt: at(10) }),
      msg({ id: "ours", author: "mock_foler_founder", content: "Photos under the same light each month help a lot.", direction: "OUTBOUND", postedAt: at(7) }),
    ]);
    expect(voices.map((v) => v.author)).toEqual(["Op_User", "Helper"]);
    expect(voices[0].role).toBe("OP");
    expect(voices[0].messageIds).toEqual(["p", "c2"]);
    expect(voices[0].text).toContain("cannot tell");
    expect(voices[0].text).toContain("never missed a dose");
    expect(voices[1].role).toBe("COMMENTER");
    expect(voices[1].prefilter).toBeUndefined();
  });

  it("pre-filters bots, deleted content and too-short voices", () => {
    const voices = splitVoices([
      msg({ id: "p", author: "someone", content: "Anyone else get an itchy scalp two weeks into minoxidil? Mine is driving me mad.", isOriginalPost: true }),
      msg({ id: "b", author: "AutoModerator", content: "Please read the rules before posting. I am a bot, and this action was performed automatically." }),
      msg({ id: "d", author: "[deleted]", content: "[removed]" }),
      msg({ id: "s", author: "short_guy", content: "same lol" }),
    ]);
    const by = Object.fromEntries(voices.map((v) => [v.author.toLowerCase(), v.prefilter]));
    expect(by.someone).toBeUndefined();
    expect(by.automoderator).toBe("bot");
    expect(by["[deleted]"]).toBe("deleted");
    expect(by.short_guy).toBe("too_short");
  });
});

describe("gateVoice", () => {
  const ctx = { title: "Is it working?", subreddit: "tressless", opText: "Six months on fin, can't tell." };
  const commenter = {
    author: "other",
    role: "COMMENTER" as const,
    messageIds: ["c"],
    text: "Same here honestly, 8 months on fin and I see zero difference in my photos.",
    wordCount: 14,
  };

  beforeEach(() => {
    vi.mocked(analyzeWithAnthropic).mockReset();
    env.ANTHROPIC_API_KEY = "test-key";
  });

  it("shows a commenter the original post as context but asks to judge only the commenter", () => {
    const p = gatePrompt(commenter, ctx);
    expect(p).toContain("ORIGINAL POST (context only");
    expect(p).toContain("Six months on fin");
    expect(p).toContain("u/other, a COMMENTER");
    expect(gatePrompt({ ...commenter, role: "OP" }, ctx)).not.toContain("ORIGINAL POST (context only");
  });

  it("maps the model's answer onto the enum and keeps its reasoning", async () => {
    vi.mocked(analyzeWithAnthropic).mockResolvedValue({
      speaks_about: "own_case",
      in_scope: true,
      minor: false,
      why: 'Says "8 months on fin and I see zero difference".',
    });
    const r = await gateVoice(commenter, ctx);
    expect(r).toMatchObject({ speaksAbout: "OWN_CASE", inScope: true, minor: false, provider: "anthropic" });
    expect(r.why).toContain("8 months");
  });

  it("never guesses: no key, API error or garbage → UNCLEAR with provider none", async () => {
    env.ANTHROPIC_API_KEY = "";
    expect(await gateVoice(commenter, ctx)).toMatchObject({ speaksAbout: "UNCLEAR", provider: "none" });

    env.ANTHROPIC_API_KEY = "k";
    vi.mocked(analyzeWithAnthropic).mockRejectedValueOnce(new Error("credit balance is too low"));
    const err = await gateVoice(commenter, ctx);
    expect(err).toMatchObject({ speaksAbout: "UNCLEAR", provider: "none" });
    expect(err.why).toContain("credit balance");

    vi.mocked(analyzeWithAnthropic).mockResolvedValueOnce({ speaks_about: "banana" });
    expect(await gateVoice(commenter, ctx)).toMatchObject({ speaksAbout: "UNCLEAR", provider: "none" });
  });

  it("decides pre-filtered voices without calling the model", async () => {
    const r = await gateVoice({ ...commenter, text: "same lol", wordCount: 2, prefilter: "too_short" }, ctx);
    expect(r).toMatchObject({ speaksAbout: "UNCLEAR", inScope: false, provider: "prefilter" });
    const bot = await gateVoice({ ...commenter, author: "AutoModerator", prefilter: "bot" }, ctx);
    expect(bot).toMatchObject({ speaksAbout: "META", provider: "prefilter" });
    expect(analyzeWithAnthropic).not.toHaveBeenCalled();
  });
});

describe("voice sync in the database", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(analyzeWithAnthropic).mockReset();
    await setSetting(SETTING_KEYS.redditOurUsername, OUR_MOCK_USERNAME);
  });

  it("ingest creates one voice per inbound author and resets a voice when its author writes more", async () => {
    const c = MOCK_CONVERSATIONS[0];
    const { conversationId } = await ingestConversation(c.post, c.comments, "MOCK");
    const voices = await prisma.voice.findMany({ where: { conversationId }, orderBy: { role: "asc" } });
    expect(voices).toHaveLength(3);
    expect(voices.filter((v) => v.role === "OP").map((v) => v.author)).toEqual([c.post.author]);

    await prisma.voice.update({
      where: { id: voices.find((v) => v.role === "OP")!.id },
      data: { speaksAbout: "OWN_CASE", inScope: true, gatedAt: new Date(), gateProvider: "anthropic" },
    });
    await ingestConversation(
      c.post,
      [
        ...c.comments,
        {
          id: "mockc1z",
          postId: c.post.id,
          parentId: null,
          subreddit: c.post.subreddit,
          author: c.post.author,
          body: "Update: week 10 and the shedding finally slowed down a lot.",
          url: "",
          createdAt: new Date(),
        },
      ],
      "MOCK",
    );
    const op = await prisma.voice.findFirstOrThrow({ where: { conversationId, role: "OP" } });
    expect(op.messageIds).toHaveLength(2);
    expect(op.gatedAt).toBeNull();
    expect(op.speaksAbout).toBeNull();

    const again = await syncVoices(conversationId);
    expect(again).toEqual({ created: 0, changed: 0 });
  });

  it("gateVoices judges real voices, skips mock ones, and leaves undecided voices for retry", async () => {
    const c = MOCK_CONVERSATIONS[0];
    const real = { ...c.post, id: "realpost1", author: "real_op" };
    const { conversationId } = await ingestConversation(
      real,
      c.comments.map((k) => ({ ...k, id: `r_${k.id}`, postId: real.id })),
      "PUBLIC_WEB",
    );
    await ingestConversation(c.post, c.comments, "MOCK");

    env.ANTHROPIC_API_KEY = "k";
    vi.mocked(analyzeWithAnthropic)
      .mockResolvedValueOnce({ speaks_about: "own_case", in_scope: true, minor: false, why: "shower drain" })
      .mockResolvedValueOnce({ speaks_about: "advice_only", in_scope: null, minor: null, why: "reassures OP" })
      .mockResolvedValueOnce({ speaks_about: "own_case", in_scope: true, minor: null, why: "same thing happened to me" });

    const r = await gateVoices({ limit: 10 });
    expect(r).toMatchObject({ gated: 3, ownCase: 2, unclear: 0, undecided: 0 });
    expect(await prisma.voice.count({ where: { conversationId: { not: conversationId }, gatedAt: { not: null } } })).toBe(0);
    const own = await prisma.voice.findMany({ where: { conversationId, speaksAbout: "OWN_CASE" } });
    expect(own.map((v) => v.role).sort()).toEqual(["COMMENTER", "OP"]);

    await prisma.voice.updateMany({ where: { conversationId }, data: { gatedAt: null, speaksAbout: null } });
    vi.mocked(analyzeWithAnthropic).mockRejectedValue(new Error("credit balance is too low"));
    const down = await gateVoices({ limit: 10 });
    expect(down.undecided).toBe(3);
    const pending = await prisma.voice.findMany({ where: { conversationId } });
    expect(pending.every((v) => v.gatedAt === null && v.speaksAbout === "UNCLEAR" && v.needsReview)).toBe(true);
  });
});
