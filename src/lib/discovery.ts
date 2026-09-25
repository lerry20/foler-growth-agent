import { prisma } from "@/lib/db";
import { ingestConversation } from "@/lib/ingest";
import { qualifyConversation } from "@/lib/ai/analyze";
import { getRedditProvider, RedditProviderError } from "@/lib/reddit";
import type { RedditPost, RedditProvider } from "@/lib/reddit";
import { pauseOutbound } from "@/lib/health";
import { generateActionsForCandidates } from "@/lib/actions";
import { setSetting, getSetting, SETTING_KEYS } from "@/lib/settings";
import type { RedditSource } from "@prisma/client";

const SOURCE_BY_PROVIDER = { mock: "MOCK", public_web: "PUBLIC_WEB", official_api: "OFFICIAL_API" } as const;
const MAX_POST_AGE_MS = 90 * 864e5;

export interface DiscoveryResult {
  scanned: number;
  newLeads: number;
  newConversations: number;
  skipped: number;
  errors: string[];
}

/** Case-insensitive whole-phrase match of any search term in the post's title or body. */
export function matchesTerms(post: { title: string; body: string }, terms: string[]): boolean {
  const text = `${post.title}\n${post.body}`.toLowerCase();
  return terms.some((t) => {
    const needle = t.trim().toLowerCase();
    if (!needle) return false;
    const re = new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
    return re.test(text);
  });
}

class Stop extends Error {}

async function rateLimited(err: unknown, result: DiscoveryResult): Promise<boolean> {
  if (err instanceof RedditProviderError && err.kind === "RATE_LIMITED") {
    await pauseOutbound(`RATE_LIMITED during discovery: ${err.message}`, err.retryAfterSeconds ?? 60);
    result.errors.push(`rate limited: ${err.message}`);
    return true;
  }
  return false;
}

/**
 * Candidate posts. Preferred: each community's "new" feed (1 request → up to 100 posts),
 * filtered locally by the search terms. Fallback (providers without a feed): one search per term.
 */
async function* candidatePosts(
  provider: RedditProvider,
  subreddits: string[],
  terms: string[],
  result: DiscoveryResult,
  limitPerTerm: number,
): AsyncGenerator<RedditPost> {
  const seen = new Set<string>();
  if (provider.listNewPosts) {
    for (const sub of subreddits) {
      let posts: RedditPost[];
      try {
        posts = await provider.listNewPosts(sub, 100);
      } catch (err) {
        if (await rateLimited(err, result)) throw new Stop();
        result.errors.push(`feed r/${sub}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      for (const p of posts) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        result.scanned++;
        if (!matchesTerms(p, terms)) {
          result.skipped++;
          continue;
        }
        yield p;
      }
    }
    return;
  }
  for (const term of terms) {
    let posts: RedditPost[];
    try {
      posts = await provider.searchPosts(term, { subreddits, limit: limitPerTerm, sort: "new" });
    } catch (err) {
      if (await rateLimited(err, result)) throw new Stop();
      result.errors.push(`search "${term}": ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const p of posts) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      result.scanned++;
      yield p;
    }
  }
}

export async function runDiscovery(opts?: { categories?: string[]; limitPerTerm?: number; maxThreads?: number }): Promise<DiscoveryResult> {
  const maxThreads = opts?.maxThreads ?? 40;
  const result: DiscoveryResult = { scanned: 0, newLeads: 0, newConversations: 0, skipped: 0, errors: [] };
  const provider = await getRedditProvider();
  const source: RedditSource = SOURCE_BY_PROVIDER[provider.name] ?? "PUBLIC_WEB";

  const categories = await prisma.searchCategory.findMany({
    where: { enabled: true, ...(opts?.categories?.length ? { key: { in: opts.categories } } : {}) },
  });
  const terms = categories.flatMap((c) => c.terms);
  const communities = await prisma.communityConfig.findMany({ where: { enabled: true }, select: { name: true } });
  const subreddits = communities.map((c) => c.name);

  let threadsFetched = 0;
  try {
    for await (const post of candidatePosts(provider, subreddits, terms, result, opts?.limitPerTerm ?? 5)) {
      if (Date.now() - post.createdAt.getTime() > MAX_POST_AGE_MS) {
        result.skipped++;
        continue;
      }
      const existing = await prisma.conversation.findFirst({
        where: { redditPostId: post.id, redditCommentId: null },
        select: { id: true },
      });
      if (existing) {
        result.skipped++;
        continue;
      }
      if (threadsFetched >= maxThreads) break;
      try {
        threadsFetched++;
        const convo = await provider.getConversation(post.id, { subreddit: post.subreddit });
        const ingest = await ingestConversation(convo.post, convo.comments, source);
        if (ingest.newLead) result.newLeads++;
        if (ingest.created) {
          result.newConversations++;
          try {
            await qualifyConversation(ingest.conversationId);
          } catch (err) {
            result.errors.push(`qualify ${post.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err) {
        if (await rateLimited(err, result)) break;
        result.errors.push(`ingest ${post.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
  }

  const prev = Number(await getSetting(SETTING_KEYS.discoveryPostsScanned, "0")) || 0;
  await setSetting(SETTING_KEYS.discoveryPostsScanned, String(prev + result.scanned));

  if (result.newConversations > 0) {
    await generateActionsForCandidates();
  }

  return result;
}
