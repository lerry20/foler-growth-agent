import type { Action, ActionType, Conversation, Lead } from "@prisma/client";

export const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);

export const ACTION_LABEL: Record<ActionType, string> = {
  IGNORE: "Ignore",
  HELP: "Help (no FOLĒR)",
  ENGAGE: "Engage (no FOLĒR)",
  FOLLOW_UP: "Follow up",
  DM: "Direct message",
  INTRODUCE_FOLER: "Ask permission / introduce FOLĒR",
  WAITLIST_INVITE: "Invite to waitlist",
};

function header(action: Action, lead: Lead): string {
  if (action.type === "WAITLIST_INVITE") return "🟢 <b>WAITLIST OPPORTUNITY</b>";
  if (action.type === "INTRODUCE_FOLER") return "🟡 <b>FOLĒR OPPORTUNITY</b>";
  if (lead.category === "HOT") return "🔥 <b>HOT REDDIT OPPORTUNITY</b>";
  if (lead.category === "WARM") return "🟠 <b>WARM REDDIT OPPORTUNITY</b>";
  return "⚪ <b>REDDIT OPPORTUNITY</b>";
}

export function approvalMessageHtml(
  action: Action,
  conversation: Conversation,
  lead: Lead,
  extra: { intent: string; manualMode: boolean },
): string {
  const lines = [
    header(action, lead),
    "",
    `u/${esc(lead.redditUsername)}`,
    `r/${esc(conversation.subreddit)}`,
    "",
    `<b>Problem:</b>\n${esc(lead.problem || "—")}`,
    "",
    `<b>Intent:</b> ${esc(extra.intent)}`,
    `<b>FOLĒR relevance:</b> ${conversation.folerRelevance}/100 · <b>Lead score:</b> ${lead.leadScore}/100 (${lead.category})`,
    "",
    `<b>Recommended:</b> ${esc(ACTION_LABEL[action.type])}`,
    `<i>${esc(action.reason)}</i>`,
    "",
    `<b>Suggested response:</b>\n"${esc(action.proposedResponse)}"`,
    "",
    extra.manualMode
      ? "✍️ Manual posting: after Approve you'll get the final text to copy + a link to the thread. Paste it from your own Reddit account, then tap “I posted it”."
      : "Approving will post this reply to Reddit automatically.",
    `<code>action:${action.id}</code>`,
  ];
  return lines.join("\n");
}

export function manualPostHtml(action: Action, conversation: Conversation): string {
  const text = action.finalResponse ?? action.proposedResponse;
  return [
    "✍️ <b>Ready to post</b> — r/" + esc(conversation.subreddit),
    esc(conversation.title),
    "",
    "Tap the text to copy it, open the thread, paste it as a comment from your account, then tap “I posted it”.",
    "",
    `<pre>${esc(text)}</pre>`,
    `<code>action:${action.id}</code>`,
  ].join("\n");
}

export function decisionSuffixHtml(status: string, by: string): string {
  return `\n\n<b>→ ${esc(status)}</b> by ${esc(by)} at ${new Date().toISOString()}`;
}

export function chatIdHelpHtml(chatId: string | number): string {
  return `Hi! This chat's ID is <code>${chatId}</code>. Set <code>TELEGRAM_CHAT_ID=${chatId}</code> in the FOLĒR Pulse .env to receive approval requests here.`;
}
