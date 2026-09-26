import type { SpeaksAbout } from "@prisma/client";

/** Client-safe: plain labels for the relevance gate, no database import. */
export const SPEAKS_ABOUT_LABELS: Record<SpeaksAbout, { label: string; hint: string }> = {
  OWN_CASE: { label: "Own case", hint: "Describes their own hair/scalp situation or treatment." },
  ADVICE_ONLY: { label: "Advice only", hint: "Only advises or reacts to someone else; says nothing about themselves." },
  SOMEONE_ELSE: { label: "Someone else", hint: "Talks about a partner, parent, friend, patient…" },
  VENDOR: { label: "Seller", hint: "Promotes a product, clinic or service." },
  META: { label: "Off-topic", hint: "Jokes, moderation, links, nothing about a case." },
  UNCLEAR: { label: "Unclear", hint: "A careful reader genuinely cannot tell." },
};
