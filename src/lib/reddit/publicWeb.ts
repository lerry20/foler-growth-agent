import { env } from "@/lib/env";
import type {
  CreateCommentResult,
  ProviderCapabilities,
  RedditComment,
  RedditConversation,
  RedditPost,
  RedditProvider,
  RedditUser,
  SearchOptions,
} from "./types";
import { RedditProviderError } from "./types";

const MIN_INTERVAL_MS = 6500;
const postSubreddits = new Map<string, string>();

export function threadUrls(postId: string, subreddit?: string): { json: string; rss: string } {
  return subreddit
    ? {
        json: `https://www.reddit.com/r/${subreddit}/comments/${postId}.json`,
        rss: `https://www.reddit.com/r/${subreddit}/comments/${postId}/.rss`,
      }
    : {
        json: `https://www.reddit.com/comments/${postId}.json`,
        rss: `https://www.reddit.com/comments/${postId}/.rss`,
      };
}
let queue: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  const next = queue.then(() => new Promise<void>((r) => setTimeout(r, MIN_INTERVAL_MS)));
  queue = next;
  return queue;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

export function htmlToText(html: string): string {
  return decodeEntities(
    decodeEntities(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  ).trim();
}

interface AtomEntry {
  id: string;
  author: string;
  link: string;
  updated: Date;
  title: string;
  content: string;
}

export function parseAtomEntries(xml: string): AtomEntry[] {
  const entries: AtomEntry[] = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const e = m[1];
    const grab = (tag: string) => e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? "";
    const id = decodeEntities(grab("id")).replace(/^t[13]_/, "");
    const author = e.match(/<author>\s*<name>([^<]+)<\/name>/)?.[1]?.replace(/^\/u\//, "").trim() ?? "";
    const link = e.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "";
    const updated = new Date(grab("updated") || grab("published") || 0);
    const title = decodeEntities(grab("title"));
    const content = htmlToText(grab("content"));
    if (id) entries.push({ id, author, link: decodeEntities(link), updated, title, content });
  }
  return entries;
}

export function entryToPost(e: AtomEntry): RedditPost {
  const subreddit = e.link.match(/\/r\/([^/]+)\//)?.[1] ?? "";
  if (subreddit) postSubreddits.set(e.id, subreddit);
  return {
    id: e.id,
    subreddit,
    author: e.author,
    title: e.title.replace(/^\[?.*?\]?\s*:\s*/, "") || e.title,
    body: e.content,
    url: e.link.split("?")[0],
    createdAt: e.updated,
  };
}

export function entryToComment(e: AtomEntry, postId: string): RedditComment {
  const subreddit = e.link.match(/\/r\/([^/]+)\//)?.[1] ?? "";
  return {
    id: e.id,
    postId,
    parentId: null,
    subreddit,
    author: e.author,
    body: e.content,
    url: `${e.link.split("?")[0]}${e.id}/`,
    createdAt: e.updated,
  };
}

async function fetchRaw(url: string): Promise<Response> {
  await throttle();
  let res = await fetch(url, { headers: { "User-Agent": env.REDDIT_USER_AGENT } });
  if (res.status === 429) {
    const waitSec = Math.min(Number(res.headers.get("Retry-After")) || 60, 120);
    await new Promise<void>((r) => setTimeout(r, waitSec * 1000));
    res = await fetch(url, { headers: { "User-Agent": env.REDDIT_USER_AGENT } });
  }
  if (res.status === 429 || res.status === 403) {
    const retryAfter = Number(res.headers.get("Retry-After")) || 60;
    throw new RedditProviderError(
      `Reddit returned ${res.status} for ${url}`,
      res.status === 429 ? "RATE_LIMITED" : "FORBIDDEN",
      retryAfter,
    );
  }
  if (res.status === 404) throw new RedditProviderError(`not found: ${url}`, "NOT_FOUND");
  return res;
}

async function fetchJsonOrRss(jsonUrl: string, rssUrl: string): Promise<{ kind: "json"; data: unknown } | { kind: "rss"; xml: string }> {
  try {
    const res = await fetchRaw(jsonUrl);
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) throw new RedditProviderError(`non-JSON response`, "FORBIDDEN", 60);
    return { kind: "json", data: await res.json() };
  } catch (err) {
    if (err instanceof RedditProviderError && err.kind === "FORBIDDEN") {
      const res = await fetchRaw(rssUrl);
      return { kind: "rss", xml: await res.text() };
    }
    throw err;
  }
}

interface JsonChild {
  kind: string;
  data: Record<string, unknown>;
}

function jsonPost(d: Record<string, unknown>): RedditPost {
  return {
    id: String(d.id),
    subreddit: String(d.subreddit),
    author: String(d.author),
    title: String(d.title ?? ""),
    body: String(d.selftext ?? ""),
    url: `https://www.reddit.com${d.permalink}`,
    createdAt: new Date(Number(d.created_utc) * 1000),
    score: Number(d.score ?? 0),
    numComments: Number(d.num_comments ?? 0),
  };
}

function jsonComment(d: Record<string, unknown>, postId: string): RedditComment | null {
  if (d.id === undefined || d.body === undefined) return null;
  const parent = String(d.parent_id ?? "");
  const permalink = String(d.link_permalink ?? d.permalink ?? "");
  const base = permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`;
  return {
    id: String(d.id),
    postId,
    parentId: parent.startsWith("t1_") ? parent.slice(3) : null,
    subreddit: String(d.subreddit ?? ""),
    author: String(d.author ?? ""),
    body: String(d.body),
    url: `${base.split("?")[0].replace(/\/$/, "")}/${d.id}/`,
    createdAt: new Date(Number(d.created_utc ?? 0) * 1000),
    score: Number(d.score ?? 0),
  };
}

function flattenComments(children: JsonChild[] | undefined, postId: string, out: RedditComment[]) {
  for (const c of children ?? []) {
    if (c.kind !== "t1") continue;
    const cm = jsonComment(c.data, postId);
    if (cm) out.push(cm);
    const replies = c.data.replies as { data?: { children?: JsonChild[] } } | "" | undefined;
    if (replies && typeof replies === "object") flattenComments(replies.data?.children, postId, out);
  }
}

export class PublicWebProvider implements RedditProvider {
  readonly name = "public_web" as const;
  readonly capabilities: ProviderCapabilities = {
    search: true,
    readConversation: true,
    createComment: false,
    monitorReplies: true,
  };

  async searchPosts(query: string, options?: SearchOptions): Promise<RedditPost[]> {
    const limit = options?.limit ?? 10;
    const sort = options?.sort ?? "new";
    const subs = options?.subreddits?.filter(Boolean) ?? [];
    const enc = encodeURIComponent(query);
    const jsonUrl = subs.length
      ? `https://www.reddit.com/r/${subs.join("+")}/search.json?q=${enc}&restrict_sr=1&sort=${sort}&limit=${limit}&type=link`
      : `https://www.reddit.com/search.json?q=${enc}&sort=${sort}&limit=${limit}&type=link`;
    const rssUrl = subs.length
      ? `https://www.reddit.com/r/${subs.join("+")}/search.rss?q=${enc}&restrict_sr=1&sort=${sort}&limit=${limit}`
      : `https://www.reddit.com/search.rss?q=${enc}&sort=${sort}&limit=${limit}`;

    const res = await fetchJsonOrRss(jsonUrl, rssUrl);
    if (res.kind === "json") {
      const children = (res.data as { data?: { children?: JsonChild[] } }).data?.children ?? [];
      return children.filter((c) => c.kind === "t3").map((c) => {
        const p = jsonPost(c.data);
        if (p.subreddit) postSubreddits.set(p.id, p.subreddit);
        return p;
      });
    }
    return parseAtomEntries(res.xml)
      .filter((e) => e.link.includes("/comments/"))
      .map(entryToPost);
  }

  async listNewPosts(subreddit: string, limit = 100): Promise<RedditPost[]> {
    const res = await fetchJsonOrRss(
      `https://www.reddit.com/r/${subreddit}/new.json?limit=${limit}`,
      `https://www.reddit.com/r/${subreddit}/new/.rss?limit=${limit}`,
    );
    if (res.kind === "json") {
      const children = (res.data as { data?: { children?: JsonChild[] } }).data?.children ?? [];
      return children.filter((c) => c.kind === "t3").map((c) => {
        const p = jsonPost(c.data);
        if (p.subreddit) postSubreddits.set(p.id, p.subreddit);
        return p;
      });
    }
    return parseAtomEntries(res.xml)
      .filter((e) => e.link.includes("/comments/"))
      .map(entryToPost);
  }

  async getPost(postId: string, ref?: { subreddit?: string }): Promise<RedditPost> {
    const urls = threadUrls(postId, ref?.subreddit ?? postSubreddits.get(postId));
    const res = await fetchJsonOrRss(urls.json, urls.rss);
    if (res.kind === "json") {
      const listing = res.data as { data?: { children?: JsonChild[] } }[];
      const t3 = listing[0]?.data?.children?.find((c) => c.kind === "t3");
      if (!t3) throw new RedditProviderError(`post ${postId} not found`, "NOT_FOUND");
      return jsonPost(t3.data);
    }
    const entries = parseAtomEntries(res.xml);
    const postEntry = entries.find((e) => e.id === postId) ?? entries[0];
    if (!postEntry) throw new RedditProviderError(`post ${postId} not found`, "NOT_FOUND");
    return entryToPost(postEntry);
  }

  async getComments(postId: string, ref?: { subreddit?: string }): Promise<RedditComment[]> {
    const urls = threadUrls(postId, ref?.subreddit ?? postSubreddits.get(postId));
    const res = await fetchJsonOrRss(urls.json, urls.rss);
    if (res.kind === "json") {
      const listing = res.data as { data?: { children?: JsonChild[] } }[];
      const out: RedditComment[] = [];
      flattenComments(listing[1]?.data?.children, postId, out);
      return out;
    }
    return parseAtomEntries(res.xml)
      .filter((e) => e.id !== postId)
      .map((e) => entryToComment(e, postId));
  }

  async getConversation(postId: string, ref?: { subreddit?: string }): Promise<RedditConversation> {
    const urls = threadUrls(postId, ref?.subreddit ?? postSubreddits.get(postId));
    const res = await fetchJsonOrRss(urls.json, urls.rss);
    if (res.kind === "json") {
      const listing = res.data as { data?: { children?: JsonChild[] } }[];
      const t3 = listing[0]?.data?.children?.find((c) => c.kind === "t3");
      if (!t3) throw new RedditProviderError(`post ${postId} not found`, "NOT_FOUND");
      const comments: RedditComment[] = [];
      flattenComments(listing[1]?.data?.children, postId, comments);
      return { post: jsonPost(t3.data), comments };
    }
    const entries = parseAtomEntries(res.xml);
    const postEntry = entries.find((e) => e.id === postId);
    if (!postEntry) throw new RedditProviderError(`post ${postId} not found`, "NOT_FOUND");
    const comments = entries.filter((e) => e.id !== postId).map((e) => entryToComment(e, postId));
    return { post: entryToPost(postEntry), comments };
  }

  async getUser(username: string): Promise<RedditUser> {
    try {
      const res = await fetchRaw(`https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`);
      const j = (await res.json()) as { data?: Record<string, unknown> };
      const d = j.data ?? {};
      return {
        username,
        profileUrl: `https://www.reddit.com/user/${username}/`,
        accountAgeDays: d.created_utc ? Math.floor((Date.now() / 1000 - Number(d.created_utc)) / 86400) : undefined,
        karma: d.total_karma !== undefined ? Number(d.total_karma) : undefined,
      };
    } catch {
      return { username, profileUrl: `https://www.reddit.com/user/${username}/` };
    }
  }

  async createComment(): Promise<CreateCommentResult> {
    throw new RedditProviderError("public_web provider cannot post comments (manual mode)", "UNSUPPORTED");
  }

  async getReplies(postId: string, commentId: string | null, ref?: { subreddit?: string }): Promise<RedditComment[]> {
    const comments = await this.getComments(postId, ref);
    return comments.filter((c) => c.parentId === commentId);
  }
}
