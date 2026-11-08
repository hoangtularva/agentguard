import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";
import { getCurrentUser } from "@/server/app-context";
import { listUsers, overviewStats } from "@/server/queries";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "AgentGuard", template: "%s · AgentGuard" },
  description: "Action intent & data provenance firewall for AI agent tool calls.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Live security data: never prerender at build time (the build must not need a database).
  await connection();
  const [user, users, stats] = await Promise.all([getCurrentUser(), listUsers(), overviewStats()]);
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background">
        <Providers>
          <AppShell user={{ id: user.id, name: user.name, role: user.role }} users={users} pending={stats.pending}>
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
