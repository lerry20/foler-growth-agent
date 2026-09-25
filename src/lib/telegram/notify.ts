import { env } from "@/lib/env";
import { isTelegramConfigured, sendMessage } from "./client";
import { approvalMessageHtml } from "./templates";
import type { Action, Conversation, Lead } from "@prisma/client";

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
      [{ text: "Open dashboard", url: `${env.APP_BASE_URL}/conversations/${conversation.id}` }],
    ],
  });
  if (!res?.ok || res.result?.message_id === undefined) return null;
  return { messageId: res.result.message_id, chatId };
}
