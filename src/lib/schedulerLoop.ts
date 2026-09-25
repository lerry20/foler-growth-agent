import { env } from "@/lib/env";
import { runScheduledCycle } from "@/lib/scheduler";

const g = globalThis as unknown as { __folerSchedulerLoop?: ReturnType<typeof setInterval> };

export function startSchedulerLoop(): void {
  const minutes = env.SCHEDULER_INTERVAL_MINUTES;
  if (!minutes || minutes <= 0) return;
  if (g.__folerSchedulerLoop) return;
  g.__folerSchedulerLoop = setInterval(() => {
    runScheduledCycle().catch((err) => console.error("scheduled cycle failed:", err));
  }, minutes * 60_000);
  g.__folerSchedulerLoop.unref?.();
  console.log(`Scheduler loop started (every ${minutes} min)`);
}
