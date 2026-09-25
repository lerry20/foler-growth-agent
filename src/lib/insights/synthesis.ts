import { env } from "@/lib/env";
import { computeInsights } from "./aggregate";
import { setSetting, getSetting } from "@/lib/settings";

export async function generateSynthesis(): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) return "Synthesis unavailable: no ANTHROPIC_API_KEY";
  const insights = await computeInsights();
  const { unmetNeeds, ...rest } = insights;
  const input = JSON.stringify({ ...rest, unmetNeeds: unmetNeeds.map((u) => ({ text: u.text, subreddit: u.subreddit })) });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 1500,
      temperature: 0.4,
      system: "You are a health-population analyst.",
      messages: [{
        role: "user",
        content: `From these aggregated Reddit signals write a founder-facing brief in markdown: 1) the 5 biggest problems people are trying to solve, 2) what they struggle with most and why, 3) gaps nobody is serving, 4) 3 concrete opportunities for tools/products that would help — be honest about sample size.\n\n${input}`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
  const j = (await res.json()) as { content?: { type: string; text?: string }[] };
  const md = (j.content ?? []).map((c) => c.text ?? "").join("\n").trim();
  await setSetting("insights.synthesis", md);
  await setSetting("insights.synthesisAt", new Date().toISOString());
  return md;
}

export async function getSynthesis(): Promise<{ markdown: string; generatedAt: string }> {
  const [markdown, generatedAt] = await Promise.all([
    getSetting("insights.synthesis", ""),
    getSetting("insights.synthesisAt", ""),
  ]);
  return { markdown, generatedAt };
}
