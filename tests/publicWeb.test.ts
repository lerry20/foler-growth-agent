import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAtomEntries, entryToPost, entryToComment, htmlToText, PublicWebProvider, threadUrls, rateLimitDelaySec } from "@/lib/reddit/publicWeb";
import { RedditProviderError } from "@/lib/reddit/types";

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>t3_1abc23</id>
    <author><name>/u/someuser</name></author>
    <link href="https://www.reddit.com/r/tressless/comments/1abc23/how_do_i_measure/"/>
    <updated>2025-01-01T12:00:00+00:00</updated>
    <title>How do I measure hair density?</title>
    <content>&lt;p&gt;I want to &lt;b&gt;track&lt;/b&gt; density &amp;amp; growth.&lt;/p&gt;</content>
  </entry>
  <entry>
    <id>t1_c456</id>
    <author><name>/u/commenter</name></author>
    <link href="https://www.reddit.com/r/tressless/comments/1abc23/how_do_i_measure/c456/"/>
    <updated>2025-01-01T13:00:00+00:00</updated>
    <title>re: How do I measure hair density?</title>
    <content>&lt;p&gt;same light every time&lt;/p&gt;</content>
  </entry>
</feed>`;

describe("publicWeb Atom parsing", () => {
  it("parses entries with id/author/url/date", () => {
    const entries = parseAtomEntries(ATOM);
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe("1abc23");
    expect(entries[0].author).toBe("someuser");
    expect(entries[0].link).toContain("/comments/1abc23/");
    expect(entries[0].updated.toISOString()).toBe("2025-01-01T12:00:00.000Z");
  });
  it("converts entries to posts/comments with decoded text", () => {
    const entries = parseAtomEntries(ATOM);
    const post = entryToPost(entries[0]);
    expect(post.subreddit).toBe("tressless");
    expect(post.body).toContain("track");
    expect(htmlToText("&lt;p&gt;a &amp;amp; b&lt;/p&gt;")).toBe("a & b");
    const comment = entryToComment(entries[1], "1abc23");
    expect(comment.postId).toBe("1abc23");
    expect(comment.url).toContain("c456");
  });
});

describe("threadUrls", () => {
  it("builds subreddit-scoped urls when subreddit given", () => {
    expect(threadUrls("1abc23", "tressless")).toEqual({
      json: "https://www.reddit.com/r/tressless/comments/1abc23.json",
      rss: "https://www.reddit.com/r/tressless/comments/1abc23/.rss",
    });
  });
  it("falls back to bare /comments/ urls without subreddit", () => {
    expect(threadUrls("1abc23")).toEqual({
      json: "https://www.reddit.com/comments/1abc23.json",
      rss: "https://www.reddit.com/comments/1abc23/.rss",
    });
  });
});

describe("publicWeb error handling", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to RSS when JSON returns 403", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      if (url.endsWith(".json") || url.includes(".json?"))
        return new Response("forbidden", { status: 403 });
      return new Response(ATOM, { status: 200, headers: { "content-type": "application/atom+xml" } });
    });
    const provider = new PublicWebProvider();
    const posts = await provider.searchPosts("hair density");
    expect(calls[0]).toContain("search.json");
    expect(calls[1]).toContain("search.rss");
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0].id).toBe("1abc23");
  });

  it("throws RATE_LIMITED on 429 with retry-after", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("slow down", { status: 429, headers: { "Retry-After": "1" } }),
    );
    const provider = new PublicWebProvider();
    await expect(provider.searchPosts("x")).rejects.toMatchObject({
      kind: "RATE_LIMITED",
      retryAfterSeconds: 1,
    });
    await expect(provider.searchPosts("x")).rejects.toBeInstanceOf(RedditProviderError);
  });
});

describe("rateLimitDelaySec", () => {
  it("prefers Retry-After, then x-ratelimit-reset (+2 s), else 60 s, capped at 120 s", () => {
    expect(rateLimitDelaySec(new Headers({ "Retry-After": "7" }))).toBe(7);
    expect(rateLimitDelaySec(new Headers({ "x-ratelimit-reset": "40" }))).toBe(42);
    expect(rateLimitDelaySec(new Headers({ "Retry-After": "0", "x-ratelimit-reset": "3" }))).toBe(5);
    expect(rateLimitDelaySec(new Headers())).toBe(60);
    expect(rateLimitDelaySec(new Headers({ "Retry-After": "900" }))).toBe(120);
  });
});
