import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

function loadDotEnv() {
  if (process.env.DATABASE_URL) return;
  const p = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadDotEnv();

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-5"),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHAT_ID: z.string().default(""),
  REDDIT_PROVIDER: z.enum(["mock", "public_web", "official_api"]).default("public_web"),
  REDDIT_USER_AGENT: z.string().default("web:foler-growth-agent:v0.1 (by /u/<your_username>)"),
  REDDIT_OUR_USERNAME: z.string().default(""),
  REDDIT_CLIENT_ID: z.string().default(""),
  REDDIT_CLIENT_SECRET: z.string().default(""),
  REDDIT_USERNAME: z.string().default(""),
  REDDIT_PASSWORD: z.string().default(""),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  ATTRIBUTION_WEBHOOK_SECRET: z.string().default(""),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
