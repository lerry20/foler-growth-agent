import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { analyzeWithAnthropic } from "@/lib/ai/anthropic";
import { struggleRulesText } from "./taxonomy";
import { validateStruggles, type StruggleEvidence } from "./evidence";
import { detectStruggles } from "./heuristicStruggles";
import { verifyStruggles } from "./verify";

const SYSTEM = `You classify Reddit posts about hair problems into a fixed taxonomy. Return ONLY a JSON object:
{"problem_theme": string /* 3-7 words, lowercase, canonical class of problem */,
 "struggle_evidence": [{"tag": string, "quote": string}] /* 1-2 items normally, 3 at most. quote = 5-25 VERBATIM words from the post proving the tag; no quote -> omit the tag */,
 "unmet_need": string /* one sentence: what would help this person that they don't have today */}

STRUGGLE TAG RULES (precision over recall; if in doubt, leave it out):
${struggleRulesText()}`;

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
    let evidence: StruggleEvidence[] = [];
    let unmet = "";
    if (env.ANTHROPIC_API_KEY) {
      try {
        const raw = (await analyzeWithAnthropic(SYSTEM, `r/${c.subreddit}\n\n${postText}`)) as {
          problem_theme?: string; struggle_evidence?: { tag?: unknown; quote?: unknown }[]; unmet_need?: string;
        };
        theme = String(raw.problem_theme ?? "").trim().toLowerCase();
        evidence = (await verifyStruggles(validateStruggles(raw.struggle_evidence, postText).evidence)).kept;
        unmet = String(raw.unmet_need ?? "");
      } catch {
        evidence = detectStruggles(postText);
      }
    } else {
      evidence = detectStruggles(postText);
    }
    if (!theme && !evidence.length && !unmet) continue;
    await prisma.conversation.update({
      where: { id: c.id },
      data: { problemTheme: theme, struggleTags: evidence.map((e) => e.tag), struggleEvidence: evidence.map((e) => ({ ...e })), unmetNeed: unmet },
    });
    updated++;
  }
  return updated;
}
