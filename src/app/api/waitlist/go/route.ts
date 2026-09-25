import { NextResponse } from "next/server";
import { recordClick } from "@/lib/attribution";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const leadId = url.searchParams.get("lead_id");
  const conversationId = url.searchParams.get("conversation_id") ?? undefined;
  const target = url.searchParams.get("target") ?? "";
  if (!target.startsWith("http")) return NextResponse.json({ error: "missing target" }, { status: 400 });

  if (leadId) {
    try {
      await recordClick({ leadId, conversationId });
    } catch {
      // still redirect
    }
  }
  const dest = new URL(target);
  for (const [k, v] of url.searchParams) {
    if (k !== "target") dest.searchParams.set(k, v);
  }
  return NextResponse.redirect(dest.toString(), 302);
}
