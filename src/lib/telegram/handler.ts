import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { approveAction, rejectAction, snoozeAction } from "@/lib/actions";
import { getSetting, setSetting } from "@/lib/settings";
import { answerCallbackQuery, editMessageText, sendMessage } from "./client";
import type { TelegramUpdate } from "./client";
import { chatIdHelpHtml, decisionSuffixHtml, esc } from "./templates";

const pendingEditKey = (chatId: string | number) => `telegram.pendingEdit.${chatId}`;

function authorized(chatId: string | number): boolean {
  if (!env.TELEGRAM_CHAT_ID) return false;
  return String(chatId) === String(env.TELEGRAM_CHAT_ID);
}

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const cb = update.callback_query;
  if (cb?.data?.startsWith("cb:")) {
    const chatId = cb.message?.chat.id;
    const messageId = cb.message?.message_id;
    if (chatId === undefined || messageId === undefined) return;
    if (!authorized(chatId)) {
      await answerCallbackQuery(
        cb.id,
        env.TELEGRAM_CHAT_ID ? "Unauthorized" : "Bot not configured: set TELEGRAM_CHAT_ID",
      );
      return;
    }
    const parts = cb.data.split(":");
    const verb = parts[1];
    const actionId = parts[2];
    const version = parts[3] !== undefined ? Number(parts[3]) : undefined;
    const append = async (status: string) => {
      const original = esc(cb.message?.text ?? "");
      await editMessageText(chatId, messageId, original + decisionSuffixHtml(status, String(chatId)));
    };

    if (verb === "approve") {
      const res = await approveAction(actionId, { by: `telegram:${chatId}`, expectedVersion: version });
      if (!res.ok) {
        await answerCallbackQuery(cb.id, "Stale — the conversation changed; open the dashboard");
        await append(`STALE (${res.reason ?? ""})`);
      } else {
        await answerCallbackQuery(cb.id, "Approved");
        await append("APPROVED");
      }
    } else if (verb === "reject") {
      const action = await prisma.action.findUnique({ where: { id: actionId } });
      if (action && version !== undefined && version !== action.conversationVersion) {
        await answerCallbackQuery(cb.id, "Stale — the conversation changed; open the dashboard");
        await append("STALE");
      } else {
        await rejectAction(actionId, { by: `telegram:${chatId}` });
        await answerCallbackQuery(cb.id, "Rejected");
        await append("REJECTED");
      }
    } else if (verb === "snooze") {
      await snoozeAction(actionId);
      await answerCallbackQuery(cb.id, "Snoozed 24h");
      await append("SNOOZED 24h");
    } else if (verb === "edit") {
      await setSetting(pendingEditKey(chatId), actionId);
      await answerCallbackQuery(cb.id, "Send the edited text as a reply to this message");
      await sendMessage(chatId, "Send the edited text as a reply to this message");
    }
    return;
  }

  const msg = update.message;
  if (msg?.text !== undefined) {
    const chatId = msg.chat.id;
    if (!authorized(chatId)) {
      await sendMessage(chatId, chatIdHelpHtml(chatId));
      return;
    }
    const pending = await getSetting(pendingEditKey(chatId), "");
    if (pending) {
      await setSetting(pendingEditKey(chatId), "");
      const res = await approveAction(pending, { by: `telegram-edit:${chatId}`, finalResponse: msg.text });
      await sendMessage(chatId, res.ok ? "Approved with edited text." : `Could not approve: ${res.reason}`);
      return;
    }
    if (msg.text === "/start" || !env.TELEGRAM_CHAT_ID) {
      await sendMessage(chatId, chatIdHelpHtml(chatId));
    }
  }
}
