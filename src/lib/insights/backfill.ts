import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { analyzeWithAnthropic } from "@/lib/ai/anthropic";
import { STRUGGLE_TAGS, type StruggleTag } from "./taxonomy";

const TAG_SET = new Set<string>(STRUGGLE_TAGS);

const SYSTEM = `You classify Reddit posts about hair problems into a fixed taxonomy. Return ONLY a JSON object:
{"problem_theme": string /* 3-7 words, lowercase, canonical class of problem */,
 "struggle_tags": string[] /* 1-3 tags, only from: ${STRUGGLE_TAGS.join(", ")} */,
 "unmet_need": string /* one sentence: what would help this person that they don't have today */}`;

function heuristicTags(text: string): string[] {
  const t = text.toLowerCase();
  const tags: string[] = [];
  if (/(working|progress|difference)/.test(t)) tags.push("UNCERTAINTY_IF_WORKING");
  if (/(measure|track|photo|compare)/.test(t)) tags.push("MEASUREMENT_TRACKING");
  if (/(side effect|libido|shed)/.test(t)) tags.push("SIDE_EFFECTS");
  if (/(cost|expensive|afford)/.test(t)) tags.push("COST");
  if (/(derm|doctor|prescription)/.test(t)) tags.push("ACCESS_TO_CARE");
  return tags.slice(0, 3);
}

export async function backfillInsights(opts?: { limit?: number }): Promise<number> {
  const conversations = await prisma.conversation.findMany({
    where: { problemTheme: "", lastAnalyzedAt: { not: null }, lead: { isMock: false }, source: { not: "MOCK" } },
    include: { messages: { where: { isOriginalPost: true }, take: 1 } },
    orderBy: { createdAt: "desc" },
    take: opts?.limit ?? 20,
  });
  let updated = 0;
  for (const c of conversations) {
    const postText = `${c.title}\n${c.messages[0]?.content ?? ""}`.slice(0, 4000);
    let theme = "";
    let tags: string[] = [];
    let unmet = "";
    if (env.ANTHROPIC_API_KEY) {
      try {
        const raw = (await analyzeWithAnthropic(SYSTEM, `r/${c.subreddit}\n\n${postText}`)) as {
          problem_theme?: string; struggle_tags?: string[]; unmet_need?: string;
        };
        theme = String(raw.problem_theme ?? "").trim().toLowerCase();
        tags = (raw.struggle_tags ?? []).filter((t): t is StruggleTag => TAG_SET.has(String(t)));
        unmet = String(raw.unmet_need ?? "");
      } catch {
        tags = heuristicTags(postText);
      }
    } else {
      tags = heuristicTags(postText);
    }
    if (!theme && !tags.length && !unmet) continue;
    await prisma.conversation.update({
      where: { id: c.id },
      data: { problemTheme: theme, struggleTags: tags, unmetNeed: unmet },
    });
    updated++;
  }
  return updated;
}
