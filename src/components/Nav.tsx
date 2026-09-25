"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Users, BarChart3, Lightbulb, Settings, Send } from "lucide-react";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/people", label: "People", icon: Users },
  { href: "/insights", label: "Insights", icon: Lightbulb },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(path: string, href: string) {
  if (href === "/") return path === "/";
  if (href === "/people") return path.startsWith("/people") || path.startsWith("/conversations");
  return path.startsWith(href);
}

export function SideNav() {
  const path = usePathname();
  return (
    <nav className="space-y-0.5">
      {NAV.map((n) => {
        const active = isActive(path, n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
              active ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            }`}
          >
            <n.icon size={15} strokeWidth={1.75} />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-zinc-200 bg-white/95 backdrop-blur md:hidden [padding-bottom:env(safe-area-inset-bottom)]">
      {NAV.map((n) => {
        const active = isActive(path, n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${active ? "text-zinc-900" : "text-zinc-400"}`}
          >
            <n.icon size={18} strokeWidth={active ? 2.25 : 1.75} />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
