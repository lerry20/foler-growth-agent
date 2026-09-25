export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { env } = await import("@/lib/env");
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_MODE !== "webhook") {
      const { startTelegramPolling } = await import("@/lib/telegram/poller");
      startTelegramPolling();
    }
    if (env.SCHEDULER_INTERVAL_MINUTES > 0) {
      const { startSchedulerLoop } = await import("@/lib/schedulerLoop");
      startSchedulerLoop();
    }
  }
}
