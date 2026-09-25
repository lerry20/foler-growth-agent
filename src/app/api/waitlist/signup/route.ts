import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { recordSignup } from "@/lib/attribution";

export async function POST(req: Request) {
  const secret = req.headers.get("x-webhook-secret");
  if (!env.ATTRIBUTION_WEBHOOK_SECRET || secret !== env.ATTRIBUTION_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json()) as {
    lead_id?: string;
    conversation_id?: string;
    email?: string;
    source?: string;
    campaign?: string;
  };
  if (!body.lead_id && !body.conversation_id) {
    return NextResponse.json({ error: "lead_id or conversation_id required" }, { status: 400 });
  }
  let leadId = body.lead_id;
  if (!leadId && body.conversation_id) {
    const { prisma } = await import("@/lib/db");
    const convo = await prisma.conversation.findUnique({ where: { id: body.conversation_id } });
    leadId = convo?.leadId;
  }
  if (!leadId) return NextResponse.json({ error: "lead not found" }, { status: 404 });
  await recordSignup({ leadId, conversationId: body.conversation_id, source: body.source ?? "webhook" });
  return NextResponse.json({ ok: true });
}
