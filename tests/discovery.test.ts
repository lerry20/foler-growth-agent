import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { matchesTerms, runDiscovery } from "@/lib/discovery";
import { RedditProviderError } from "@/lib/reddit/types";
import { MockProvider } from "@/lib/reddit/mock";
import { MOCK_CONVERSATIONS } from "@/lib/reddit/mockData";
import { env } from "@/lib/env";
import { resetDb } from "./helpers";

vi.mock("@/lib/reddit", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/reddit")>();
  return { ...orig, getRedditProvider: vi.fn() };
});

const { getRedditProvider } = await import("@/lib/reddit");

describe("discovery rate-limit handling", () => {
  beforeEach(async () => {
    await resetDb();
    env.ANTHROPIC_API_KEY = "";
    await prisma.searchCategory.create({
      data: { key: "X", name: "X", terms: ["minoxidil"], enabled: true },
    });
    await prisma.communityConfig.create({ data: { name: "tressless" } });
  });

  it("RATE_LIMITED pauses outbound, writes event, stops the run", async () => {
    class FlakyProvider extends MockProvider {
      override async searchPosts(): Promise<never> {
        throw new RedditProviderError("429", "RATE_LIMITED", 60);
      }
    }
    vi.mocked(getRedditProvider).mockResolvedValue(new FlakyProvider());
    const res = await runDiscovery({ limitPerTerm: 1 });
    expect(res.errors.join(" ")).toContain("rate limited");
    const health = await prisma.accountHealth.findUniqueOrThrow({ where: { id: "default" } });
    expect(health.outboundPaused).toBe(true);
    expect(health.rateLimitHits).toBe(1);
    const ev = await prisma.event.findFirst({ where: { type: "OUTBOUND_PAUSED" } });
    expect(ev).toBeTruthy();
  });

  it("mock provider discovery ingests conversations", async () => {
    vi.mocked(getRedditProvider).mockResolvedValue(new MockProvider());
    const res = await runDiscovery({ limitPerTerm: 5 });
    expect(res.errors).toHaveLength(0);
    expect(res.newConversations).toBeGreaterThan(0);
  });

  it("uses the subreddit feed when available and matches terms locally", async () => {
    const mock = new MockProvider();
    const all = MOCK_CONVERSATIONS.map((c) => c.post);
    const feed = vi.fn(async () => all);
    const search = vi.spyOn(mock, "searchPosts");
    Object.assign(mock, { listNewPosts: feed });
    vi.mocked(getRedditProvider).mockResolvedValue(mock);

    const res = await runDiscovery();
    expect(feed).toHaveBeenCalledTimes(1);
    expect(feed).toHaveBeenCalledWith("tressless", 100);
    expect(search).not.toHaveBeenCalled();
    expect(res.scanned).toBe(all.length);
    const expected = all.filter((p) => matchesTerms(p, ["minoxidil"])).length;
    expect(expected).toBeGreaterThan(0);
    expect(res.newConversations).toBe(expected);
  });
});

describe("matchesTerms", () => {
  const post = (title: string, body = "") => ({ title, body });

  it("is case-insensitive and matches in title or body", () => {
    expect(matchesTerms(post("Is Minoxidil worth it?"), ["minoxidil"])).toBe(true);
    expect(matchesTerms(post("help", "started fin 3 months ago"), ["fin"])).toBe(true);
  });

  it("requires the whole phrase, not a substring", () => {
    expect(matchesTerms(post("finally some results"), ["fin"])).toBe(false);
    expect(matchesTerms(post("is it working?"), ["is it working"])).toBe(true);
    expect(matchesTerms(post("is it really working?"), ["is it working"])).toBe(false);
  });

  it("treats punctuation as a boundary and ignores empty terms", () => {
    expect(matchesTerms(post("(shedding)"), ["shedding"])).toBe(true);
    expect(matchesTerms(post("shedding."), ["", "  ", "shedding"])).toBe(true);
    expect(matchesTerms(post("nothing here"), ["", "  "])).toBe(false);
  });
});
