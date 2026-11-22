import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";
import { SignIn } from "@/components/sign-in";
import { demoAuthEnabled } from "@/server/identity";
import { getCurrentUser } from "@/server/app-context";
import { listUsers, overviewStats } from "@/server/queries";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Callwrit", template: "%s · Callwrit" },
  description: "Action intent & data provenance firewall for AI agent tool calls.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Live security data: never prerender at build time (the build must not need a database).
  await connection();
  const [user, users] = await Promise.all([getCurrentUser(), listUsers()]);
  const stats = user ? await overviewStats(user) : null;
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background">
        <Providers>
          {user && stats ? (
            <AppShell user={{ id: user.id, name: user.name, role: user.role }} users={users} pending={stats.pending} demoAuth={demoAuthEnabled()}>
              {children}
            </AppShell>
          ) : (
            <SignIn users={users} demoAuth={demoAuthEnabled()} />
          )}
        </Providers>
      </body>
    </html>
  );
}
