import { prisma } from "../src/lib/db";
import { gateVoices, syncVoices } from "../src/lib/voices/sync";

/** Split every real conversation into voices, then run the relevance gate on the ungated ones. */
async function main() {
  const limit = Number(process.argv[2] ?? 200);
  const convos = await prisma.conversation.findMany({
    where: { source: { not: "MOCK" }, lead: { isMock: false } },
    select: { id: true },
  });
  let created = 0;
  let changed = 0;
  for (const c of convos) {
    const r = await syncVoices(c.id);
    created += r.created;
    changed += r.changed;
  }
  const gate = await gateVoices({ limit });
  const total = await prisma.voice.count({ where: { conversation: { source: { not: "MOCK" } } } });
  console.log(JSON.stringify({ conversations: convos.length, voicesCreated: created, voicesReset: changed, voicesTotal: total, gate }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
