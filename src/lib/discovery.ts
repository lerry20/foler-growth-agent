import { prisma } from "@/lib/db";
import { ingestConversation } from "@/lib/ingest";
import { qualifyConversation } from "@/lib/ai/analyze";
import { getRedditProvider, RedditProviderError } from "@/lib/reddit";
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

export async function runDiscovery(opts?: { categories?: string[]; limitPerTerm?: number; maxThreads?: number }): Promise<DiscoveryResult> {
  const maxThreads = opts?.maxThreads ?? 12;
  const result: DiscoveryResult = { scanned: 0, newLeads: 0, newConversations: 0, skipped: 0, errors: [] };
  const provider = await getRedditProvider();
  const source: RedditSource = SOURCE_BY_PROVIDER[provider.name] ?? "PUBLIC_WEB";

  const categories = await prisma.searchCategory.findMany({
    where: { enabled: true, ...(opts?.categories?.length ? { key: { in: opts.categories } } : {}) },
  });
  const communities = await prisma.communityConfig.findMany({ where: { enabled: true }, select: { name: true } });
  const subreddits = communities.map((c) => c.name);

  let stopped = false;
  let threadsFetched = 0;
  for (const cat of categories) {
    for (const term of cat.terms) {
      if (stopped) break;
      let posts;
      try {
        posts = await provider.searchPosts(term, {
          subreddits,
          limit: opts?.limitPerTerm ?? 5,
          sort: "new",
        });
      } catch (err) {
        if (err instanceof RedditProviderError && err.kind === "RATE_LIMITED") {
          await pauseOutbound(`RATE_LIMITED during discovery: ${err.message}`, err.retryAfterSeconds ?? 60);
          result.errors.push(`rate limited: ${err.message}`);
          stopped = true;
          break;
        }
        result.errors.push(`search "${term}": ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      for (const post of posts) {
        result.scanned++;
        if (stopped) break;
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
        if (threadsFetched >= maxThreads) {
          stopped = true;
          break;
        }
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
          if (err instanceof RedditProviderError && err.kind === "RATE_LIMITED") {
            await pauseOutbound(`RATE_LIMITED during discovery: ${err.message}`, err.retryAfterSeconds ?? 60);
            result.errors.push(`rate limited: ${err.message}`);
            stopped = true;
            break;
          }
          result.errors.push(`ingest ${post.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  const prev = Number(await getSetting(SETTING_KEYS.discoveryPostsScanned, "0")) || 0;
  await setSetting(SETTING_KEYS.discoveryPostsScanned, String(prev + result.scanned));

  if (result.newConversations > 0) {
    await generateActionsForCandidates();
  }

  return result;
}
