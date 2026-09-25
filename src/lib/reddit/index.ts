import { env } from "@/lib/env";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { MockProvider } from "./mock";
import { OfficialApiProvider } from "./officialApi";
import { PublicWebProvider } from "./publicWeb";
import type { RedditProvider, RedditProviderName } from "./types";

export const providerLabel: Record<RedditProviderName, string> = {
  mock: "Mock (demo data)",
  public_web: "Public web (no API key, read-only)",
  official_api: "Official Reddit API",
};

let providerOverride: RedditProvider | null = null;
export function setProviderForTests(p: RedditProvider | null): void {
  providerOverride = p;
}

export async function getRedditProvider(): Promise<RedditProvider> {
  if (providerOverride) return providerOverride;
  const setting = await getSetting(SETTING_KEYS.redditProvider, "");
  const name = (setting || env.REDDIT_PROVIDER || "public_web") as RedditProviderName;
  switch (name) {
    case "mock":
      return new MockProvider();
    case "official_api":
      return new OfficialApiProvider();
    case "public_web":
    default:
      return new PublicWebProvider();
  }
}

export * from "./types";
