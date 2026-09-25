import { env } from "@/lib/env";
import { isTelegramConfigured, sendMessage, type InlineButton } from "./client";
import { approvalMessageHtml } from "./templates";
import type { Action, Conversation, Lead } from "@prisma/client";

const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i;

// Telegram rejects inline-button URLs pointing at localhost, so the row is omitted for local dev.
function dashboardRows(conversationId: string): InlineButton[][] {
  const base = env.APP_BASE_URL;
  if (!base || LOCAL_HOST.test(base)) return [];
  return [[{ text: "Open dashboard", url: `${base}/conversations/${conversationId}` }]];
}

export async function sendActionForApproval(
  action: Action,
  conversation: Conversation,
  lead: Lead,
): Promise<{ messageId: number; chatId: string } | null> {
  if (!isTelegramConfigured() || !env.TELEGRAM_CHAT_ID) return null;
  const chatId = env.TELEGRAM_CHAT_ID;
  const provider = await import("@/lib/reddit").then((m) => m.getRedditProvider());
  const text = approvalMessageHtml(action, conversation, lead, {
    intent: lead.intent,
    manualMode: !provider.capabilities.createComment,
  });
  const res = await sendMessage(chatId, text, {
    inline_keyboard: [
      [
        { text: "Approve", callback_data: `cb:approve:${action.id}:${action.conversationVersion}` },
        { text: "Edit", callback_data: `cb:edit:${action.id}` },
      ],
      [
        { text: "Reject", callback_data: `cb:reject:${action.id}:${action.conversationVersion}` },
        { text: "Snooze", callback_data: `cb:snooze:${action.id}` },
      ],
      ...dashboardRows(conversation.id),
    ],
  });
  if (!res?.ok || res.result?.message_id === undefined) return null;
  return { messageId: res.result.message_id, chatId };
}
