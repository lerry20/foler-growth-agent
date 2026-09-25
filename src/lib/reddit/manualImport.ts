import { ingestConversation } from "@/lib/ingest";
import { getRedditProvider } from "./index";
import type { RedditPost } from "./types";
import { RedditProviderError } from "./types";

export function parseRedditUrl(url: string): { subreddit: string; postId: string; commentId?: string } {
  const m = url.match(/reddit\.com\/r\/([^/]+)\/comments\/([a-z0-9]+)(?:\/[^/]*\/([a-z0-9]+))?/i);
  if (!m) throw new RedditProviderError(`cannot parse Reddit URL: ${url}`, "PARSE");
  return { subreddit: m[1], postId: m[2], commentId: m[3] };
}

export async function importConversationFromUrl(url: string) {
  const { postId, subreddit } = parseRedditUrl(url);
  const provider = await getRedditProvider();
  const convo = await provider.getConversation(postId, { subreddit });
  return ingestConversation(convo.post, convo.comments, "MANUAL_IMPORT");
}

export async function importConversationFromText(input: {
  url: string;
  subreddit: string;
  author: string;
  title: string;
  body: string;
  createdAt: Date;
}) {
  const { postId } = parseRedditUrl(input.url);
  const post: RedditPost = {
    id: postId,
    subreddit: input.subreddit,
    author: input.author,
    title: input.title,
    body: input.body,
    url: input.url,
    createdAt: input.createdAt,
  };
  return ingestConversation(post, [], "MANUAL_IMPORT");
}
