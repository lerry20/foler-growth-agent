import { defineConfig } from "vitest/config";
import path from "node:path";

const devUrl = process.env.DATABASE_URL ?? "postgresql://foler:foler@localhost:5432/foler_growth_agent";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? devUrl.replace(/\/[^/]+$/, "/foler_growth_agent_test");

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
