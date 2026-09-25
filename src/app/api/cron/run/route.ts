import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runScheduledCycle } from "@/lib/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  if (!env.CRON_SECRET) return false;
  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${env.CRON_SECRET}`) return true;
  return req.headers.get("x-cron-secret") === env.CRON_SECRET;
}

async function handler(req: Request) {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runScheduledCycle();
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return handler(req);
}

export async function POST(req: Request) {
  return handler(req);
}
