import { execSync } from "node:child_process";

const devUrl = process.env.DATABASE_URL ?? "postgresql://foler:foler@localhost:5432/foler_growth_agent";
const url = process.env.TEST_DATABASE_URL ?? devUrl.replace(/\/[^/]+$/, "/foler_growth_agent_test");
execSync("npx prisma db push --skip-generate", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
