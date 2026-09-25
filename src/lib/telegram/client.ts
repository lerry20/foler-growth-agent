import { env } from "@/lib/env";

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramResponse {
  ok: boolean;
  result?: { message_id?: number } & Record<string, unknown>;
  description?: string;
}

export function isTelegramConfigured(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN);
}

async function call<T = TelegramResponse>(method: string, body: Record<string, unknown>): Promise<T | null> {
  if (!isTelegramConfigured()) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function sendMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: { inline_keyboard: InlineButton[][] },
): Promise<TelegramResponse | null> {
  return call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export function editMessageText(chatId: string | number, messageId: number, text: string): Promise<TelegramResponse | null> {
  return call("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML" });
}

export function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<TelegramResponse | null> {
  return call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

export interface TelegramUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string; message_id: number; from?: { id: number } };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number; text?: string };
    from?: { id: number };
  };
}

export async function getUpdates(offset?: number, timeout = 25): Promise<{ ok: boolean; result: TelegramUpdate[] } | null> {
  return call("getUpdates", { offset, timeout, allowed_updates: ["message", "callback_query"] });
}
