import { env } from "@/lib/env";
import { getUpdates, isTelegramConfigured } from "./client";
import { handleUpdate } from "./handler";

const g = globalThis as unknown as { __folerTelegramPoller?: boolean };

export function startTelegramPolling(): void {
  if (!isTelegramConfigured() || g.__folerTelegramPoller) return;
  g.__folerTelegramPoller = true;
  let offset = 0;
  const loop = async () => {
    for (;;) {
      try {
        const res = await getUpdates(offset, 25);
        for (const u of res?.result ?? []) {
          offset = u.update_id + 1;
          try {
            await handleUpdate(u);
          } catch (err) {
            console.error("telegram update error", err);
          }
        }
      } catch (err) {
        console.error("telegram poll error", err);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  void loop();
  console.log("Telegram polling started (chat:", env.TELEGRAM_CHAT_ID || "unset", ")");
}
