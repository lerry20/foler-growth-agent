import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getKnowledgeBase, getSetting, SETTING_KEYS } from "@/lib/settings";
import { applyGates, effectivePermissionSignal } from "@/lib/gates";
import { buildWaitlistUrl, recordSignup } from "@/lib/attribution";
import { advanceStage, STAGE_ORDER } from "@/lib/pipeline";
import { recencyScore, totalScore, categorize, normalizeBreakdown } from "@/lib/scoring";
import { buildSystemPrompt, buildUserPrompt } from "./prompts";
import { analyzeWithAnthropic } from "./anthropic";
import { analyzeHeuristically } from "./heuristic";
import { AnalysisSchema } from "./schema";
import { validateStruggles } from "@/lib/insights/evidence";
import { verifyStruggles } from "@/lib/insights/verify";
import type { Analysis, AnalysisResult } from "./types";
import type { EventType, LeadStage, PermissionState } from "@prisma/client";

function trigrams(s: string): Set<string> {
  const words = s.toLowerCase().split(/\W+/).filter(Boolean);
  const set = new Set<string>();
  for (let i = 0; i + 3 <= words.length; i++) set.add(words.slice(i, i + 3).join(" "));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function derivePermissionState(current: PermissionState, messages: { direction: string; content: string }[]): PermissionState {
  if (current !== "NO_FOLER_MENTION") return current;
  const outbound = messages.filter((m) => m.direction === "OUTBOUND");
  if (outbound.some((m) => /fol[ēe]r/i.test(m.content))) return "FOLER_INTRODUCED";
  if (outbound.some((m) => /(working on something|interested in hearing|would you be interested)/i.test(m.content)))
    return "PERMISSION_REQUESTED";
  return current;
}

export async function qualifyConversation(
  conversationId: string,
  opts?: { force?: boolean },
): Promise<AnalysisResult> {
  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { lead: true, messages: { orderBy: { postedAt: "asc" } } },
  });
  if (conversation.lastAnalyzedAt && !opts?.force) {
    const prev = conversation.lastAnalysis as unknown as AnalysisResult;
    if (prev && prev.recommended_action) return prev;
  }

  const community = await prisma.communityConfig.findUnique({ where: { name: conversation.subreddit } });
  const kb = await getKnowledgeBase();
  const ourUser = await getSetting(SETTING_KEYS.redditOurUsername, env.REDDIT_OUR_USERNAME || "mock_foler_founder");
  const campaign = await getSetting(SETTING_KEYS.attributionCampaign, "reddit-growth-agent");
  const previous = await prisma.generatedResponse.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  const previousResponses = previous.map((p) => p.text);

  const permissionState = derivePermissionState(conversation.permissionState, conversation.messages);
  if (permissionState !== conversation.permissionState) {
    await prisma.conversation.update({ where: { id: conversationId }, data: { permissionState } });
    conversation.permissionState = permissionState;
  }

  const post = conversation.messages.find((m) => m.isOriginalPost) ?? conversation.messages[0];
  const lastInbound = [...conversation.messages].reverse().find((m) => m.direction === "INBOUND");

  let analysis: Analysis;
  let provider: "anthropic" | "heuristic";

  const heuristicCtx = {
    title: conversation.title,
    body: post?.content ?? "",
    messages: conversation.messages.map((m) => ({ author: m.author, content: m.content, direction: m.direction, postedAt: m.postedAt })),
    postCreatedAt: post?.postedAt ?? conversation.createdAt,
    permissionState,
  };

  if (env.ANTHROPIC_API_KEY) {
    const userPrompt = () =>
      buildUserPrompt({
        subreddit: conversation.subreddit,
        communityNotes: community?.notes ?? "",
        promotionSensitivity: community?.promotionSensitivity ?? "MEDIUM",
        folerIntroAllowed: community?.folerIntroAllowed ?? true,
        permissionState,
        post: {
          author: post?.author ?? conversation.lead.redditUsername,
          title: conversation.title,
          body: post?.content ?? "",
          createdAt: (post?.postedAt ?? conversation.createdAt).toISOString(),
        },
        messages: conversation.messages.map((m) => ({
          author: m.author,
          content: m.content,
          direction: m.direction,
          postedAt: m.postedAt.toISOString(),
        })),
        ourUsername: ourUser,
        previousResponses,
      });
    try {
      const raw = await analyzeWithAnthropic(buildSystemPrompt(kb), userPrompt());
      analysis = AnalysisSchema.parse(raw);
      provider = "anthropic";
    } catch (err) {
      analysis = analyzeHeuristically(heuristicCtx);
      analysis.reason = `[fallback after LLM error: ${err instanceof Error ? err.message : String(err)}] ${analysis.reason}`;
      provider = "heuristic";
    }
    // Similarity check
    if (provider === "anthropic" && analysis.suggested_response) {
      const tri = trigrams(analysis.suggested_response);
      const tooSimilar = previousResponses.some((p) => jaccard(tri, trigrams(p)) > 0.6);
      if (tooSimilar) {
        try {
          const raw = await analyzeWithAnthropic(
            buildSystemPrompt(kb),
            userPrompt() + "\nYour previous draft was too similar to a recent reply; write a substantively different one.",
          );
          analysis = AnalysisSchema.parse(raw);
        } catch {
          // keep the first draft
        }
      }
    }
  } else {
    analysis = analyzeHeuristically(heuristicCtx);
    provider = "heuristic";
  }

  // A struggle tag only counts when the person's own words back it up.
  const theirs = conversation.messages.filter(
    (m) => m.direction === "INBOUND" && (m.isOriginalPost || m.author.toLowerCase() === conversation.lead.redditUsername.toLowerCase()),
  );
  const ownWords = [conversation.title, ...theirs.map((m) => m.content)].join("\n");
  const struggles = validateStruggles(analysis.struggle_evidence, ownWords);
  const judged = await verifyStruggles(struggles.evidence);
  analysis.struggle_tags = judged.kept.map((e) => e.tag);
  analysis.struggle_evidence = judged.kept;

  const breakdown = normalizeBreakdown({
    problemRelevance: analysis.scores.problem_relevance,
    measurementIntent: analysis.scores.measurement_intent,
    treatmentJourney: analysis.scores.treatment_journey,
    conversationOpportunity: analysis.scores.conversation_opportunity,
    productIntent: analysis.scores.product_intent,
    recency: recencyScore(lastInbound?.postedAt ?? post?.postedAt ?? new Date()),
  });
  const total = totalScore(breakdown);
  const category = categorize(total);

  const { analysis: gated, blocked } = applyGates(analysis, {
    subreddit: conversation.subreddit,
    permissionState,
    waitlistUrl: kb.waitlistUrl,
    community,
    leadScore: total,
    hasOutbound: conversation.messages.some((m) => m.direction === "OUTBOUND"),
    postText: [conversation.title, post?.content].filter(Boolean).join("\n"),
  });
  analysis = gated;

  if (analysis.suggested_response.includes("{{WAITLIST_URL}}")) {
    const url = kb.waitlistUrl
      ? buildWaitlistUrl(kb.waitlistUrl, {
          subreddit: conversation.subreddit,
          leadId: conversation.leadId,
          conversationId: conversation.id,
          campaign,
        })
      : "";
    analysis.suggested_response = analysis.suggested_response.replace(/\{\{WAITLIST_URL\}\}/g, url);
  }

  const result: AnalysisResult = { ...analysis, provider, blocked };

  await prisma.lead.update({
    where: { id: conversation.leadId },
    data: {
      problem: analysis.problem,
      hairConcern: analysis.hair_concern,
      treatment: analysis.treatment,
      treatmentDuration: analysis.treatment_duration,
      intent: analysis.intent,
      relevanceScore: analysis.foler_relevance,
      conversationOpportunity: analysis.conversation_opportunity,
      conversionPotential: analysis.conversion_potential,
      leadScore: total,
      scoreBreakdown: breakdown as unknown as object,
      category,
      lastActivityAt: new Date(),
      ...(blocked.some((b) => b.startsWith("Minor protection")) ? { doNotContact: true } : {}),
    },
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      folerRelevance: analysis.foler_relevance,
      lastAnalysis: result as unknown as object,
      lastAnalyzedAt: new Date(),
      analysisProvider: provider,
      problemTheme: analysis.problem_theme,
      struggleTags: analysis.struggle_tags,
      struggleEvidence: analysis.struggle_evidence,
      unmetNeed: analysis.unmet_need,
    },
  });

  // Stage / permission transitions
  let convoStage: LeadStage = advanceStage(conversation.stage, "QUALIFIED");
  let permState: PermissionState = conversation.permissionState;
  const events: { type: EventType; payload?: object }[] = [];
  if (conversation.stage === "DISCOVERED") {
    events.push({ type: "LEAD_QUALIFIED", payload: { category, total } });
  }
  const effectiveSignal = effectivePermissionSignal(analysis.permission_signal, permState).signal;
  if (effectiveSignal === "PERMISSION_GRANTED" && permState !== "PERMISSION_GRANTED") {
    permState = "PERMISSION_GRANTED";
    events.push({ type: "PERMISSION_GRANTED" });
  }
  if (effectiveSignal === "INTEREST_EXPRESSED" && permState !== "INTEREST_DETECTED") {
    permState = "INTEREST_DETECTED";
  }
  if (analysis.permission_signal === "ALREADY_SIGNED_UP") {
    await recordSignup({ leadId: conversation.leadId, conversationId, source: "reddit-self-reported" });
    permState = "WAITLIST_SIGNUP";
    convoStage = "WAITLIST_SIGNUP";
    events.push({ type: "WAITLIST_SIGNUP" });
  }
  if (analysis.foler_relevance >= 70 && permState === "NO_FOLER_MENTION") {
    permState = "FOLER_RELEVANCE_DETECTED";
    events.push({ type: "FOLER_RELEVANCE_DETECTED" });
    if (STAGE_ORDER.indexOf(conversation.stage) >= STAGE_ORDER.indexOf("HELPING")) {
      convoStage = advanceStage(convoStage, "FOLER_RELEVANT");
    }
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { stage: convoStage, permissionState: permState },
  });
  for (const e of events) {
    await prisma.event.create({
      data: { type: e.type, leadId: conversation.leadId, conversationId, payload: e.payload },
    });
  }

  // Mirror stage onto the lead (max pipeline order across conversations)
  const leadConvos = await prisma.conversation.findMany({ where: { leadId: conversation.leadId }, select: { stage: true } });
  let leadStage = conversation.lead.stage;
  for (const c of leadConvos) leadStage = advanceStage(leadStage, c.stage);
  if (leadStage !== conversation.lead.stage) {
    await prisma.lead.update({ where: { id: conversation.leadId }, data: { stage: leadStage } });
  }

  if (analysis.suggested_response) {
    await prisma.generatedResponse.create({ data: { text: analysis.suggested_response } });
  }

  return result;
}
