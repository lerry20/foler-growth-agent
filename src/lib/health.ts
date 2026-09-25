import { prisma } from "@/lib/db";

export async function pauseOutbound(reason: string, retryAfterSeconds = 60): Promise<void> {
  const until = new Date(Date.now() + retryAfterSeconds * 1000);
  await prisma.accountHealth.upsert({
    where: { id: "default" },
    update: {
      rateLimitHits: { increment: 1 },
      lastRateLimitAt: new Date(),
      outboundPaused: true,
      pausedReason: reason,
      pausedUntil: until,
    },
    create: {
      id: "default",
      rateLimitHits: 1,
      lastRateLimitAt: new Date(),
      outboundPaused: true,
      pausedReason: reason,
      pausedUntil: until,
    },
  });
  await prisma.event.create({ data: { type: "OUTBOUND_PAUSED", payload: { reason, until } } });
}

export async function resumeOutbound(): Promise<void> {
  await prisma.accountHealth.update({
    where: { id: "default" },
    data: { outboundPaused: false, pausedReason: null, pausedUntil: null },
  });
  await prisma.event.create({ data: { type: "OUTBOUND_RESUMED" } });
}

export async function recordError(message: string): Promise<void> {
  await prisma.accountHealth.upsert({
    where: { id: "default" },
    update: { errors: { increment: 1 }, lastError: message },
    create: { id: "default", errors: 1, lastError: message },
  });
  await prisma.event.create({ data: { type: "PROVIDER_ERROR", payload: { message } } });
}
