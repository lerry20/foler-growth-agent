import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FOLĒR Growth Agent",
  description: "Internal growth agent for FOLĒR",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
