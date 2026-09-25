import { runDiscovery } from "../src/lib/discovery";
import { prisma } from "../src/lib/db";

runDiscovery()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
