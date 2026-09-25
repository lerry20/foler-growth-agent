import { refreshAll } from "@/lib/monitoring";
import { runDiscovery, type DiscoveryResult } from "@/lib/discovery";
import { generateActionsForCandidates } from "@/lib/actions";
import { backfillInsights } from "@/lib/insights/backfill";
import { setSetting } from "@/lib/settings";

export interface CycleResult {
  skipped: boolean;
  discovery: DiscoveryResult | null;
  monitoring: { refreshed: number; errors: string[]; manual: number } | null;
  actionsGenerated: number;
  insightsBackfilled: number;
  errors: string[];
  durationMs: number;
}

const g = globalThis as unknown as { __folerCycleRunning?: boolean };

export async function runScheduledCycle(opts?: {
  maxThreads?: number;
  limitPerTerm?: number;
  refreshLimit?: number;
}): Promise<CycleResult> {
  if (g.__folerCycleRunning) {
    return { skipped: true, discovery: null, monitoring: null, actionsGenerated: 0, insightsBackfilled: 0, errors: [], durationMs: 0 };
  }
  g.__folerCycleRunning = true;
  const started = Date.now();
  const result: CycleResult = {
    skipped: false,
    discovery: null,
    monitoring: null,
    actionsGenerated: 0,
    insightsBackfilled: 0,
    errors: [],
    durationMs: 0,
  };
  try {
    try {
      result.monitoring = await refreshAll({ limit: opts?.refreshLimit ?? 10 });
      result.errors.push(...result.monitoring.errors.map((e) => `monitoring: ${e}`));
    } catch (err) {
      result.errors.push(`monitoring: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      result.discovery = await runDiscovery({
        limitPerTerm: opts?.limitPerTerm ?? 3,
        maxThreads: opts?.maxThreads ?? 25,
      });
      result.errors.push(...result.discovery.errors.map((e) => `discovery: ${e}`));
    } catch (err) {
      result.errors.push(`discovery: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      result.actionsGenerated = await generateActionsForCandidates();
    } catch (err) {
      result.errors.push(`actions: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      result.insightsBackfilled = await backfillInsights({ limit: 10 });
    } catch (err) {
      result.errors.push(`insights: ${err instanceof Error ? err.message : String(err)}`);
    }
    result.durationMs = Date.now() - started;
    return result;
  } finally {
    g.__folerCycleRunning = false;
    await setSetting("scheduler.lastRunAt", new Date().toISOString()).catch(() => {});
    await setSetting("scheduler.lastResult", JSON.stringify(result)).catch(() => {});
  }
}
