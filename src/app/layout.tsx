import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { prisma } from "@/lib/db";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { env } from "@/lib/env";
import { providerLabel } from "@/lib/reddit";
import type { RedditProviderName } from "@/lib/reddit";
import { SideNav, BottomNav } from "@/components/Nav";
import { Toaster } from "@/components/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "FOLĒR Pulse",
  description: "Internal growth agent for FOLĒR",
};

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [health, mockCount, providerSetting] = await Promise.all([
    prisma.accountHealth.findUnique({ where: { id: "default" } }),
    prisma.lead.count({ where: { isMock: true } }),
    getSetting(SETTING_KEYS.redditProvider, ""),
  ]);
  const provider = (providerSetting || env.REDDIT_PROVIDER || "public_web") as RedditProviderName;

  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans text-[13px] text-zinc-800 bg-zinc-50 antialiased">
        <div className="flex min-h-screen">
          <aside className="sticky top-0 hidden h-screen w-48 shrink-0 border-r border-zinc-200 bg-white px-3 py-4 md:block">
            <div className="px-2 pb-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              FOLĒR Pulse
            </div>
            <SideNav />
          </aside>
          <div className="flex-1 min-w-0 pb-16 md:pb-0">
            <header className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2.5 md:px-5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 md:hidden">FOLĒR Pulse</span>
              <span className="hidden text-zinc-400 md:inline">Provider:</span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700">
                {providerLabel[provider] ?? provider}
              </span>
              {health?.outboundPaused && (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                  Outbound paused{health.pausedReason ? `: ${health.pausedReason}` : ""}
                </span>
              )}
              {mockCount > 0 && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                  MOCK DATA
                </span>
              )}
            </header>
            <main className="overflow-x-clip p-3 md:p-5">{children}</main>
          </div>
        </div>
        <BottomNav />
        <Toaster />
      </body>
    </html>
  );
}
