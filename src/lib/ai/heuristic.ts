import type { Analysis } from "./types";
import { detectStruggles } from "@/lib/insights/heuristicStruggles";

export interface HeuristicContext {
  title: string;
  body: string;
  messages: { author: string; content: string; direction: "INBOUND" | "OUTBOUND"; postedAt: Date }[];
  postCreatedAt: Date;
  permissionState: string;
}

const T = (a: Analysis): Analysis => a;

export function analyzeHeuristically(ctx: HeuristicContext): Analysis {
  const lastInbound = [...ctx.messages].reverse().find((m) => m.direction === "INBOUND");
  const text = `${ctx.title} ${ctx.body} ${lastInbound?.content ?? ""}`.toLowerCase();
  const hasOutbound = ctx.messages.some((m) => m.direction === "OUTBOUND");
  const commentCount = ctx.messages.length;

  let measurementIntent = 0;
  if (
    /(how (do|can) i|how to) (measure|track|compare|know if|tell if)/.test(text) ||
    /can'?t (tell|see) (if|whether|a difference)|is (it|this) (even )?working|not sure if .* working|don'?t know if .* working/.test(text)
  )
    measurementIntent = 25;
  else if (/(track|measure|progress photo|before and after|density)/.test(text)) measurementIntent = 15;

  let problemRelevance = 0;
  if (measurementIntent >= 25) problemRelevance = 30;
  else if (measurementIntent >= 15) problemRelevance = 18;
  else if (/(thinning|shedding|hair ?loss|balding|receding|density|scalp)/.test(text)) problemRelevance = 8;

  const drug = text.match(/(minoxidil|finasteride|dutasteride|prp|transplant|ketoconazole|microneedl\w*)/)?.[1];
  const duration = text.match(/\d+\s*(week|month|year)s?/)?.[0];
  let treatmentJourney = 0;
  if (drug && duration) treatmentJourney = 15;
  else if (drug) treatmentJourney = 8;
  const treatment = drug ? drug[0].toUpperCase() + drug.slice(1) : "";
  const treatment_duration = duration ?? "";

  let productIntent = 0;
  if (
    /(device|app|scanner|tool|camera|gadget|something that)/.test(text) &&
    /(track|measure|density|analy[sz]e|monitor)/.test(text)
  )
    productIntent = 10;

  const ageDays = (Date.now() - ctx.postCreatedAt.getTime()) / 864e5;
  let conversationOpportunity = 2;
  if (ageDays < 7 && commentCount < 5) conversationOpportunity = 12;
  else if (ageDays < 30) conversationOpportunity = 6;

  let intent: Analysis["intent"] = "OTHER";
  if (productIntent === 10) intent = "PRODUCT_INTENT";
  else if (measurementIntent === 25 && /measure|track|compare/.test(text)) intent = "MEASUREMENT";
  else if (measurementIntent === 25) intent = "UNCERTAINTY";
  else if (treatmentJourney > 0) intent = "TREATMENT_JOURNEY";
  else if (problemRelevance > 0) intent = "HAIR_PROBLEM";

  const li = (lastInbound?.content ?? "").toLowerCase();
  let permission_signal: Analysis["permission_signal"] = "NONE";
  if (/(signed up|joined the waitlist|on the waitlist)/.test(li)) permission_signal = "ALREADY_SIGNED_UP";
  else if (
    (ctx.permissionState === "FOLER_INTRODUCED" || ctx.permissionState === "INTEREST_DETECTED") &&
    /(sounds|where can i|sign up|interested|let me know|link)/.test(li)
  )
    permission_signal = "INTEREST_EXPRESSED";
  else if (
    (ctx.permissionState === "PERMISSION_REQUESTED" || ctx.permissionState === "PERMISSION_GRANTED") &&
    (/^(sure|yes|yeah|ok|okay|absolutely|what|tell me|go ahead|i'?d)/.test(li) ||
      /(what are you (working|building)|tell me more|sure)/.test(li))
  )
    permission_signal = "PERMISSION_GRANTED";
  else if (/(no thanks|not interested|stop|spam)/.test(li)) permission_signal = "DECLINED";

  const foler_relevance = Math.round((problemRelevance / 30) * 0.5 * 100 + (measurementIntent / 25) * 0.35 * 100 + (productIntent / 10) * 0.15 * 100);
  const conversation_opportunity = Math.round((conversationOpportunity / 15) * 100);
  const conversion_potential = Math.round(foler_relevance * 0.6 + productIntent * 4);

  let recommended_action: Analysis["recommended_action"];
  let should_mention_foler = false;
  let suggested_response = "";
  let reason = "";

  const label = "[heuristic fallback — no LLM key] ";
  const treatmentWord = treatment || "progress";

  if (permission_signal === "INTEREST_EXPRESSED") {
    recommended_action = "WAITLIST_INVITE";
    suggested_response = "Glad it resonates. We're opening the early waitlist here if you'd like to take a look: {{WAITLIST_URL}}";
    reason = "Person explicitly expressed interest after the FOLĒR introduction; waitlist invite is appropriate.";
  } else if (permission_signal === "PERMISSION_GRANTED") {
    recommended_action = "INTRODUCE_FOLER";
    should_mention_foler = true;
    suggested_response =
      "Sure — we're building FOLĒR, which is focused on making hair and scalp changes more measurable over time. Still early and not public yet, but happy to answer questions.";
    reason = "Person granted permission to hear about the project; introduce FOLĒR with approved description.";
  } else if (permission_signal === "ALREADY_SIGNED_UP") {
    recommended_action = "FOLLOW_UP";
    suggested_response = `Thanks for signing up — really appreciate it. Good luck with the ${treatmentWord === "progress" ? "journey" : treatmentWord}, and feel free to ping me with questions.`;
    reason = "Person reports already signing up; brief thanks, no further ask.";
  } else if (permission_signal === "DECLINED") {
    recommended_action = "FOLLOW_UP";
    suggested_response = "No worries, thanks anyway. Good luck with everything.";
    reason = "Person declined; brief polite close with no FOLĒR content.";
  } else if (
    ctx.permissionState === "FOLER_RELEVANCE_DETECTED" &&
    hasOutbound &&
    productIntent === 10
  ) {
    recommended_action = "INTRODUCE_FOLER";
    suggested_response = "I'm actually working on something related to exactly this problem. Would you be interested in hearing about it?";
    reason = "Strong product intent after a helpful exchange; ask permission before mentioning FOLĒR.";
  } else if (measurementIntent === 25 || productIntent === 10) {
    recommended_action = "ENGAGE";
    suggested_response = `${duration ? duration + " is" : "This is"} an awkward point because gradual changes are almost impossible to see in the mirror. How are you comparing right now — memory, photos, or something more structured?`;
    reason = "Clear measurement/tracking struggle; start a genuine conversation without mentioning FOLĒR.";
  } else if (hasOutbound && lastInbound) {
    recommended_action = "FOLLOW_UP";
    suggested_response =
      "Good question — the most reliable thing is keeping conditions identical every time so any change you see is real. How are you comparing right now?";
    reason = "Existing conversation with a new inbound message; continue helping.";
  } else if (problemRelevance >= 8) {
    recommended_action = "HELP";
    suggested_response = `It's really hard to judge ${treatmentWord} changes by eye, especially day to day. Are you taking photos under the same lighting, angle and distance each time? That alone makes comparisons much more reliable.`;
    reason = "Relevant hair concern where practical measurement advice helps; no FOLĒR mention.";
  } else {
    recommended_action = "IGNORE";
    reason = "Little relevance to the tracking/measurement problem; nothing genuine to add.";
  }

  const struggle_evidence = detectStruggles(`${ctx.title}\n${ctx.body}\n${lastInbound?.content ?? ""}`);

  return T({
    problem: ctx.title,
    hair_concern: /(thinning|shedding|hair ?loss|balding|receding|density|scalp)/.exec(text)?.[1] ?? "",
    treatment,
    treatment_duration,
    problem_theme: "",
    struggle_tags: struggle_evidence.map((e) => e.tag),
    struggle_evidence,
    unmet_need: "",
    intent,
    foler_relevance,
    conversation_opportunity,
    conversion_potential,
    recommended_action,
    should_mention_foler,
    permission_signal,
    reason: label + reason,
    suggested_response,
    scores: {
      problem_relevance: problemRelevance,
      measurement_intent: measurementIntent,
      treatment_journey: treatmentJourney,
      conversation_opportunity: conversationOpportunity,
      product_intent: productIntent,
    },
  });
}
