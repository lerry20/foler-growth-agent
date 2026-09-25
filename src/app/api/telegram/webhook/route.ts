import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { handleUpdate } from "@/lib/telegram/handler";
import type { TelegramUpdate } from "@/lib/telegram/client";

export async function POST(req: Request) {
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const token = req.headers.get("x-telegram-bot-api-secret-token");
    if (token !== env.TELEGRAM_WEBHOOK_SECRET) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const update = (await req.json()) as TelegramUpdate;
  try {
    await handleUpdate(update);
  } catch (err) {
    console.error("[telegram/webhook] update failed", err);
  }
  return NextResponse.json({ ok: true });
}
