"use client";

import { Activity, Bot, ChevronsLeft, ChevronsRight, FlaskConical, Inbox, LayoutDashboard, LogOut, Menu, Moon, Plug, ScrollText, ShieldHalf, Sun, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState, useSyncExternalStore } from "react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/playground", label: "Agent Playground", icon: Bot },
  { href: "/attack-lab", label: "Attack Lab", icon: FlaskConical },
  { href: "/approvals", label: "Approval Inbox", icon: Inbox, badge: "pending" as const },
  { href: "/events", label: "Security Events", icon: Activity },
  { href: "/policies", label: "Policy Studio", icon: ScrollText },
  { href: "/apps", label: "Apps & API keys", icon: Plug },
];

type User = { id: string; name: string; role: string };

function NavLinks({ collapsed, pending, onNavigate }: { collapsed: boolean; pending: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 px-2" aria-label="Main">
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              active && "bg-muted font-medium text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            <Icon className={cn("size-4 shrink-0", active && "text-brand")} />
            {!collapsed && <span className="truncate">{item.label}</span>}
            {!collapsed && item.badge === "pending" && pending > 0 && (
              <span className="ml-auto rounded-full bg-review/15 px-1.5 text-[11px] font-medium text-review tabular">{pending}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/" className={cn("flex h-14 items-center gap-2 px-4", collapsed && "justify-center px-0")}>
      <span className="grid size-7 place-items-center rounded-md bg-brand text-white">
        <ShieldHalf className="size-4" />
      </span>
      {!collapsed && (
        <span className="text-sm font-semibold tracking-tight">
          Callwrit <span className="font-normal text-muted-foreground">/ demo</span>
        </span>
      )}
    </Link>
  );
}

const subscribe = () => () => {};

// Sidebar preference: per-viewer convenience in localStorage (safe if storage is unavailable).
const SIDEBAR_EVENT = "ag-sidebar";
function readSidebar() {
  try {
    return localStorage.getItem("ag.sidebar") === "collapsed";
  } catch {
    return false;
  }
}
function writeSidebar(collapsed: boolean) {
  try {
    localStorage.setItem("ag.sidebar", collapsed ? "collapsed" : "open");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(SIDEBAR_EVENT));
}
function subscribeSidebar(cb: () => void) {
  window.addEventListener(SIDEBAR_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(SIDEBAR_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
function useMounted() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label="Toggle color theme"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

function SignOut() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/identity", { method: "DELETE" });
        router.refresh();
      }}
      className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label="Sign out"
      title="Sign out"
    >
      <LogOut className="size-4" />
    </button>
  );
}

function UserSwitcher({ user, users }: { user: User; users: User[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <label className="flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-xs" title="Demo identity — not authentication">
      <UserRound className="size-3.5 text-muted-foreground" />
      <span className="sr-only">Acting as</span>
      <select
        className="max-w-[9.5rem] bg-transparent text-xs outline-none sm:max-w-none"
        value={user.id}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          await fetch("/api/identity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: e.target.value }) });
          setBusy(false);
          router.refresh();
        }}
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} · {u.role}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AppShell({ children, user, users, pending, demoAuth }: { children: React.ReactNode; user: User; users: User[]; pending: number; demoAuth: boolean }) {
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebar, () => false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggle = () => writeSidebar(!collapsed);

  return (
    <div className="flex min-h-dvh">
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 md:flex",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <Brand collapsed={collapsed} />
        <div className="mt-2 flex-1">
          <NavLinks collapsed={collapsed} pending={pending} />
        </div>
        <div className={cn("border-t p-2", collapsed && "flex justify-center")}>
          <button
            type="button"
            onClick={toggle}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight className="mx-auto size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur md:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger className="grid size-8 place-items-center rounded-md hover:bg-muted md:hidden" aria-label="Open navigation">
              <Menu className="size-4" />
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Brand collapsed={false} />
              <NavLinks collapsed={false} pending={pending} onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="text-sm font-semibold md:hidden">Callwrit</span>
          <div className="ml-auto flex items-center gap-2">
            {demoAuth ? (
              <UserSwitcher user={user} users={users} />
            ) : (
              <span className="rounded-md border px-2 py-1 text-xs">{user.name} · {user.role}</span>
            )}
            <ThemeToggle />
            <SignOut />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}
