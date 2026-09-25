import { env } from "../src/lib/env";

const del = process.argv.includes("--delete");

async function main() {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN not set");
    process.exit(1);
  }
  const base = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  let res: { ok?: boolean; description?: string };
  if (del) {
    res = await fetch(`${base}/deleteWebhook`, { method: "POST" }).then((r) => r.json());
  } else {
    res = await fetch(`${base}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: `${env.APP_BASE_URL}/api/telegram/webhook`,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET || undefined,
        allowed_updates: ["message", "callback_query"],
      }),
    }).then((r) => r.json());
  }
  console.log(`ok=${res.ok} ${res.description ?? ""}`.trim());
  if (!res.ok) process.exit(1);
}

main();
