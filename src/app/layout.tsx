import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { env } from "@/lib/env";
import { providerLabel } from "@/lib/reddit";
import type { RedditProviderName } from "@/lib/reddit";
import { Home, Inbox, MessagesSquare, BarChart3, Lightbulb, Settings, Send } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "FOLĒR Growth Agent",
  description: "Internal growth agent for FOLĒR",
};

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/insights", label: "Insights", icon: Lightbulb },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [health, mockCount, providerSetting] = await Promise.all([
    prisma.accountHealth.findUnique({ where: { id: "default" } }),
    prisma.lead.count({ where: { isMock: true } }),
    getSetting(SETTING_KEYS.redditProvider, ""),
  ]);
  const provider = (providerSetting || env.REDDIT_PROVIDER || "public_web") as RedditProviderName;

  return (
    <html lang="en">
      <body className="text-[13px] text-zinc-800 bg-zinc-50 antialiased">
        <div className="flex min-h-screen">
          <aside className="w-48 shrink-0 border-r border-zinc-200 bg-white px-3 py-4">
            <div className="px-2 pb-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              FOLĒR Growth
            </div>
            <nav className="space-y-0.5">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                >
                  <n.icon size={15} strokeWidth={1.75} />
                  {n.label}
                </Link>
              ))}
            </nav>
          </aside>
          <div className="flex-1 min-w-0">
            <header className="flex items-center gap-2 border-b border-zinc-200 bg-white px-5 py-2.5">
              <span className="text-zinc-400">Provider:</span>
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
            <main className="p-5">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
