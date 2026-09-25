export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { env } = await import("@/lib/env");
    if (env.SCHEDULER_INTERVAL_MINUTES > 0) {
      const { startSchedulerLoop } = await import("@/lib/schedulerLoop");
      startSchedulerLoop();
    }
  }
}
