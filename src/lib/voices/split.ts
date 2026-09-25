import type { VoiceRole } from "@prisma/client";

export interface VoiceMessage {
  id: string;
  author: string;
  content: string;
  postedAt: Date;
  direction: "INBOUND" | "OUTBOUND";
  isOriginalPost: boolean;
}

/** Why a voice was decided without asking the model. */
export type PrefilterReason = "deleted" | "bot" | "too_short";

export interface VoiceDraft {
  author: string;
  role: VoiceRole;
  messageIds: string[];
  /** Everything this author wrote in the thread, oldest first, joined by blank lines. */
  text: string;
  wordCount: number;
  prefilter?: PrefilterReason;
}

export const MIN_VOICE_WORDS = 8;

const BOT_AUTHORS = new Set(["automoderator", "reddit", "sneakpeekbot", "remindmebot"]);
const DELETED_AUTHORS = new Set(["[deleted]", "[removed]", "deleted", "removed"]);

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}

function prefilter(author: string, text: string, words: number): PrefilterReason | undefined {
  const a = author.toLowerCase();
  if (DELETED_AUTHORS.has(a) || /^\[(deleted|removed)\]$/i.test(text.trim())) return "deleted";
  if (BOT_AUTHORS.has(a) || /bot$/i.test(a) || /^i am a bot\b/i.test(text)) return "bot";
  if (words < MIN_VOICE_WORDS) return "too_short";
  return undefined;
}

/**
 * Split a thread into voices: one per distinct inbound author. The OP is the author of the
 * original post; everyone else is a commenter. Our own account (OUTBOUND) never becomes a voice.
 */
export function splitVoices(messages: VoiceMessage[]): VoiceDraft[] {
  const inbound = [...messages]
    .filter((m) => m.direction === "INBOUND")
    .sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());

  const opAuthor = inbound.find((m) => m.isOriginalPost)?.author.toLowerCase();
  const byAuthor = new Map<string, VoiceMessage[]>();
  for (const m of inbound) {
    const key = m.author.toLowerCase();
    const list = byAuthor.get(key);
    if (list) list.push(m);
    else byAuthor.set(key, [m]);
  }

  const voices: VoiceDraft[] = [];
  for (const [key, list] of byAuthor) {
    const text = list.map((m) => m.content.trim()).filter(Boolean).join("\n\n");
    const words = wordCount(text);
    voices.push({
      author: list[0].author,
      role: key === opAuthor ? "OP" : "COMMENTER",
      messageIds: list.map((m) => m.id),
      text,
      wordCount: words,
      prefilter: prefilter(list[0].author, text, words),
    });
  }
  return voices.sort((a, b) => (a.role === b.role ? 0 : a.role === "OP" ? -1 : 1));
}
