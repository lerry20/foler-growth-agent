import { prisma } from "@/lib/db";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { env } from "@/lib/env";
import type { RedditSource } from "@prisma/client";
import type { RedditPost as ProviderPost, RedditComment as ProviderComment } from "@/lib/reddit/types";

export interface IngestResult {
  leadId: string;
  conversationId: string;
  created: boolean;
  newLead: boolean;
  newMessageCount: number;
}

export async function ourUsername(): Promise<string> {
  return getSetting(SETTING_KEYS.redditOurUsername, env.REDDIT_OUR_USERNAME || "mock_foler_founder");
}

export async function ingestConversation(
  post: ProviderPost,
  comments: ProviderComment[],
  source: RedditSource,
): Promise<IngestResult> {
  const our = (await ourUsername()).toLowerCase();
  let newLead = false;

  const existingLead = await prisma.lead.findUnique({ where: { redditUsername: post.author } });
  newLead = !existingLead;
  const lead = existingLead
    ? await prisma.lead.update({ where: { id: existingLead.id }, data: { lastActivityAt: new Date() } })
    : await prisma.lead.create({
        data: {
          redditUsername: post.author,
          profileUrl: `https://www.reddit.com/user/${post.author}/`,
          subreddit: post.subreddit,
          isMock: source === "MOCK",
        },
      });

  let conversation = await prisma.conversation.findFirst({
    where: { redditPostId: post.id, redditCommentId: null },
  });

  let created = false;
  let newMessageCount = 0;
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        leadId: lead.id,
        redditPostId: post.id,
        redditUrl: post.url,
        subreddit: post.subreddit,
        title: post.title,
        source,
      },
    });
    created = true;
  }

  const messages: { redditId: string | null; author: string; content: string; postedAt: Date; direction: "INBOUND" | "OUTBOUND"; isOriginalPost: boolean }[] = [
    {
      redditId: `post_${post.id}`,
      author: post.author,
      content: `${post.title}\n\n${post.body}`.trim(),
      postedAt: post.createdAt,
      direction: post.author.toLowerCase() === our ? "OUTBOUND" : "INBOUND",
      isOriginalPost: true,
    },
    ...comments.map((c) => ({
      redditId: c.id,
      author: c.author,
      content: c.body,
      postedAt: c.createdAt,
      direction: (c.author.toLowerCase() === our ? "OUTBOUND" : "INBOUND") as "INBOUND" | "OUTBOUND",
      isOriginalPost: false,
    })),
  ];

  for (const m of messages) {
    try {
      await prisma.message.create({ data: { conversationId: conversation.id, ...m } });
      newMessageCount++;
    } catch {
      // unique (conversationId, redditId) violation => already ingested
    }
  }

  if (created || newMessageCount > 0) {
    await prisma.conversation.update({ where: { id: conversation.id }, data: { lastActivityAt: new Date() } });
  }
  if (newLead) {
    await prisma.event.create({ data: { type: "LEAD_DISCOVERED", leadId: lead.id, conversationId: conversation.id, payload: { source } } });
  }

  return { leadId: lead.id, conversationId: conversation.id, created, newLead, newMessageCount };
}
