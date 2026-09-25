import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/monitoring", () => ({ refreshAll: vi.fn() }));
vi.mock("@/lib/discovery", () => ({ runDiscovery: vi.fn() }));
vi.mock("@/lib/actions", () => ({ generateActionsForCandidates: vi.fn() }));
vi.mock("@/lib/settings", () => ({ setSetting: vi.fn(async () => {}), getSetting: vi.fn(async (_k: string, f: string) => f) }));

import { refreshAll } from "@/lib/monitoring";
import { runDiscovery } from "@/lib/discovery";
import { generateActionsForCandidates } from "@/lib/actions";
import { runScheduledCycle } from "@/lib/scheduler";
import { GET } from "@/app/api/cron/run/route";
import { env } from "@/lib/env";

const refreshAllM = vi.mocked(refreshAll);
const runDiscoveryM = vi.mocked(runDiscovery);
const generateM = vi.mocked(generateActionsForCandidates);

beforeEach(() => {
  vi.clearAllMocks();
  refreshAllM.mockResolvedValue({ refreshed: 1, manual: 0, errors: [] });
  runDiscoveryM.mockResolvedValue({ scanned: 2, newLeads: 1, newConversations: 1, skipped: 0, errors: [] });
  generateM.mockResolvedValue(3);
});

describe("runScheduledCycle", () => {
  it("runs monitoring -> discovery -> actions in order and aggregates", async () => {
    const order: string[] = [];
    refreshAllM.mockImplementation(async () => { order.push("m"); return { refreshed: 1, manual: 0, errors: [] }; });
    runDiscoveryM.mockImplementation(async () => { order.push("d"); return { scanned: 0, newLeads: 0, newConversations: 0, skipped: 0, errors: [] }; });
    generateM.mockImplementation(async () => { order.push("a"); return 2; });
    const r = await runScheduledCycle();
    expect(order).toEqual(["m", "d", "a"]);
    expect(r.skipped).toBe(false);
    expect(r.actionsGenerated).toBe(2);
    expect(r.monitoring?.refreshed).toBe(1);
    expect(r.errors).toEqual([]);
  });

  it("a throwing discovery still lets actions run and records the error", async () => {
    runDiscoveryM.mockRejectedValue(new Error("boom"));
    const r = await runScheduledCycle();
    expect(generateM).toHaveBeenCalled();
    expect(r.errors.join(" ")).toContain("boom");
    expect(r.discovery).toBeNull();
  });

  it("concurrent second call returns skipped", async () => {
    let release: () => void;
    const gate = new Promise<void>((r) => (release = r));
    refreshAllM.mockImplementation(() => gate.then(() => ({ refreshed: 0, manual: 0, errors: [] })));
    const p1 = runScheduledCycle();
    const p2 = await runScheduledCycle();
    release!();
    await p1;
    expect(p2.skipped).toBe(true);
  });
});

describe("/api/cron/run auth", () => {
  it("503 when CRON_SECRET unset", async () => {
    env.CRON_SECRET = "";
    const res = await GET(new Request("http://localhost/api/cron/run"));
    expect(res.status).toBe(503);
  });

  it("401 on wrong bearer", async () => {
    env.CRON_SECRET = "s3cret";
    const res = await GET(new Request("http://localhost/api/cron/run", { headers: { authorization: "Bearer nope" } }));
    expect(res.status).toBe(401);
  });

  it("200 on correct bearer", async () => {
    env.CRON_SECRET = "s3cret";
    const res = await GET(new Request("http://localhost/api/cron/run", { headers: { authorization: "Bearer s3cret" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe(false);
  });
});
