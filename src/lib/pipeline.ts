import type { LeadStage } from "@prisma/client";

export const STAGE_ORDER: LeadStage[] = [
  "DISCOVERED",
  "QUALIFIED",
  "APPROVAL_PENDING",
  "HELPING",
  "ENGAGED",
  "WAITING_FOR_RESPONSE",
  "ACTIVE_CONVERSATION",
  "FOLER_RELEVANT",
  "FOLER_INTRODUCED",
  "WAITLIST_INVITED",
  "WAITLIST_SIGNUP",
];

const TERMINAL: LeadStage[] = ["IGNORED", "REJECTED", "NO_RESPONSE", "NOT_RELEVANT", "LOST"];

export function advanceStage(current: LeadStage, next: LeadStage): LeadStage {
  if (next === current) return current;
  if (TERMINAL.includes(next)) return next;
  const ci = STAGE_ORDER.indexOf(current);
  const ni = STAGE_ORDER.indexOf(next);
  if (ci === -1) return next;
  if (ni === -1) return current;
  return ni > ci ? next : current;
}
