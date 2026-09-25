import { env } from "@/lib/env";

export async function analyzeWithAnthropic(system: string, user: string): Promise<unknown> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL,
      max_tokens: 1200,
      temperature: 0.4,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
  const j = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (j.content ?? []).map((c) => c.text ?? "").join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON object in model response");
  return JSON.parse(m[0]);
}
