import { env } from "@/lib/env";
import type {
  CreateCommentInput,
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

function hasCreds() {
  return Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET && env.REDDIT_USERNAME && env.REDDIT_PASSWORD);
}

export class OfficialApiProvider implements RedditProvider {
  readonly name = "official_api" as const;
  private token: string | null = null;

  get capabilities(): ProviderCapabilities {
    const ok = hasCreds();
    return { search: ok, readConversation: ok, createComment: ok, monitorReplies: ok };
  }

  private requireCreds() {
    if (!hasCreds())
      throw new RedditProviderError("Official Reddit API credentials not configured", "UNSUPPORTED");
  }

  private async auth(): Promise<string> {
    this.requireCreds();
    if (this.token) return this.token;
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        "User-Agent": env.REDDIT_USER_AGENT,
        Authorization: `Basic ${Buffer.from(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "password",
        username: env.REDDIT_USERNAME,
        password: env.REDDIT_PASSWORD,
      }),
    });
    if (!res.ok) throw new RedditProviderError(`OAuth failed: ${res.status}`, "FORBIDDEN");
    const j = (await res.json()) as { access_token: string };
    this.token = j.access_token;
    return this.token!;
  }

  private async call(path: string, init?: RequestInit): Promise<unknown> {
    const token = await this.auth();
    const res = await fetch(`https://oauth.reddit.com${path}`, {
      ...init,
      headers: { "User-Agent": env.REDDIT_USER_AGENT, Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new RedditProviderError(`Reddit API ${res.status} for ${path}`, res.status === 429 ? "RATE_LIMITED" : "NETWORK", 60);
    return res.json();
  }

  async searchPosts(query: string, options?: SearchOptions): Promise<RedditPost[]> {
    const j = (await this.call(
      `/search?q=${encodeURIComponent(query)}&sort=${options?.sort ?? "new"}&limit=${options?.limit ?? 10}&type=link`,
    )) as { data: { children: { data: Record<string, unknown> }[] } };
    return j.data.children.map((c) => this.toPost(c.data));
  }

  async getPost(postId: string): Promise<RedditPost> {
    const j = (await this.call(`/comments/${postId}`)) as { data: { children: { data: Record<string, unknown> }[] } }[];
    return this.toPost(j[0].data.children[0].data);
  }

  async getComments(postId: string): Promise<RedditComment[]> {
    const j = (await this.call(`/comments/${postId}`)) as { data: { children: { kind: string; data: Record<string, unknown> }[] } }[];
    const out: RedditComment[] = [];
    const walk = (children: { kind: string; data: Record<string, unknown> }[]) => {
      for (const c of children) {
        if (c.kind !== "t1") continue;
        const parent = String(c.data.parent_id ?? "");
        out.push({
          id: String(c.data.id),
          postId,
          parentId: parent.startsWith("t1_") ? parent.slice(3) : null,
          subreddit: String(c.data.subreddit ?? ""),
          author: String(c.data.author ?? ""),
          body: String(c.data.body ?? ""),
          url: `https://www.reddit.com${c.data.permalink ?? ""}`,
          createdAt: new Date(Number(c.data.created_utc ?? 0) * 1000),
          score: Number(c.data.score ?? 0),
        });
        const r = c.data.replies as { data?: { children?: { kind: string; data: Record<string, unknown> }[] } } | "" | undefined;
        if (r && typeof r === "object") walk(r.data?.children ?? []);
      }
    };
    walk(j[1].data.children);
    return out;
  }

  async getUser(username: string): Promise<RedditUser> {
    const j = (await this.call(`/user/${encodeURIComponent(username)}/about`)) as { data: Record<string, unknown> };
    return {
      username,
      profileUrl: `https://www.reddit.com/user/${username}/`,
      accountAgeDays: j.data.created_utc ? Math.floor((Date.now() / 1000 - Number(j.data.created_utc)) / 86400) : undefined,
      karma: j.data.total_karma !== undefined ? Number(j.data.total_karma) : undefined,
    };
  }

  async getConversation(postId: string): Promise<RedditConversation> {
    const [post, comments] = await Promise.all([this.getPost(postId), this.getComments(postId)]);
    return { post, comments };
  }

  async createComment(input: CreateCommentInput): Promise<CreateCommentResult> {
    const j = (await this.call("/api/comment", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        thing_id: `${input.parentKind === "post" ? "t3" : "t1"}_${input.parentId}`,
        text: input.text,
      }),
    })) as { json: { data: { things: { data: { id: string; permalink?: string } }[] } } };
    const t = j.json.data.things[0].data;
    return { id: t.id, url: t.permalink ? `https://www.reddit.com${t.permalink}` : "" };
  }

  async getReplies(postId: string, commentId: string | null): Promise<RedditComment[]> {
    const comments = await this.getComments(postId);
    return comments.filter((c) => c.parentId === commentId);
  }

  private toPost(d: Record<string, unknown>): RedditPost {
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
}
