import { prisma } from "@/lib/db";

export async function resetDb() {
  await prisma.generatedResponse.deleteMany();
  await prisma.event.deleteMany();
  await prisma.voice.deleteMany();
  await prisma.message.deleteMany();
  await prisma.action.deleteMany();
  await prisma.conversion.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.accountHealth.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.searchCategory.deleteMany();
  await prisma.communityConfig.deleteMany();
  await prisma.accountHealth.create({ data: { id: "default" } });
}
