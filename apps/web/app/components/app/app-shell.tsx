"use client";

/* eslint-disable @next/next/no-img-element -- the mark and avatar are tiny fixed images */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, fliqApi, type Workspace } from "../../lib/fliq-api";
import { useMe } from "../../lib/wallet-queries";
import { Icon, type IconName } from "./icons";
import { ThemeSwitch } from "./theme";
import { Avatar } from "./ui";

type NavItem = { href: string; label: string; icon: IconName; short?: string };

const WALLET: NavItem[] = [
  { href: "/wallet", label: "Home", icon: "home" },
  { href: "/wallet/send", label: "Send", icon: "send" },
  { href: "/wallet/add", label: "Add money", icon: "plus", short: "Add" },
  { href: "/wallet/activity", label: "Activity", icon: "clock" },
  { href: "/wallet/recipients", label: "Recipients", icon: "users" },
  { href: "/wallet/agents", label: "Agents", icon: "bot" },
];

const DEVELOPER: NavItem[] = [
  { href: "/dashboard", label: "Payouts", icon: "list" },
  { href: "/dashboard/webhooks", label: "Webhooks", icon: "zap" },
  { href: "/dashboard/api-keys", label: "API keys", icon: "key", short: "Keys" },
];

const ROOTS = new Set(["/wallet", "/dashboard"]);

function isActive(pathname: string, href: string) {
  if (ROOTS.has(href)) return pathname === href || (href === "/dashboard" && pathname.startsWith("/dashboard/payouts"));
  return pathname.startsWith(href);
}

function EnvChip() {
  const workspace = useQuery({
    queryKey: ["workspace"],
    queryFn: () => fliqApi<Workspace>("workspaces/current"),
    retry: false,
  });
  if (workspace.isError) return <span className="chip">Set up</span>;
  if (!workspace.data) return null;
  return workspace.data.live_enabled ? (
    <span className="chip good">
      <i className="dot" />
      Live
    </span>
  ) : (
    <span className="chip sand">
      <i className="dot" />
      Sandbox
    </span>
  );
}

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate: () => void }) {
  return (
    <Link href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined} onClick={onNavigate}>
      <Icon name={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
}

export function AppShell({ mode, children }: { mode: "wallet" | "developer"; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [menu, setMenu] = useState(false);
  const me = useMe();
  const signedOut = me.error instanceof ApiError && me.error.status === 401;
  const unclaimed = me.isSuccess && !me.data.near_account;

  useEffect(() => {
    if (signedOut) router.replace("/sign-in");
    else if (unclaimed) router.replace("/claim-name");
  }, [signedOut, unclaimed, router]);

  const logout = useMutation({
    mutationFn: () => fliqApi<void>("auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      router.replace("/sign-in");
    },
  });

  const close = () => setMenu(false);
  const items = mode === "wallet" ? WALLET : DEVELOPER;
  const tabs = items.slice(0, mode === "wallet" ? 4 : 3);
  const name = me.data?.display_name || me.data?.near_account || "Your account";

  return (
    <>
      {mode === "developer" && <div className="sandbar" aria-hidden="true" />}
      <div className="app">
        <aside className={`side ${menu ? "open" : ""}`} aria-label="Main">
          <Link className="mark" href="/wallet" onClick={close}>
            <img src="/app/mark.webp" alt="" />
            <b>fliq</b>
          </Link>
          {mode === "wallet" ? (
            <>
              <nav className="nav">
                {WALLET.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} onNavigate={close} />
                ))}
              </nav>
              <div className="navlabel">Build</div>
              <nav className="nav">
                <Link href="/dashboard" onClick={close}>
                  <Icon name="code" />
                  <span>Developer</span>
                  <span className="sp" />
                  <EnvChip />
                </Link>
              </nav>
            </>
          ) : (
            <>
              <nav className="nav">
                <Link href="/wallet" onClick={close}>
                  <Icon name="arrowL" />
                  <span>Back to wallet</span>
                </Link>
              </nav>
              <div className="navlabel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                Developer <EnvChip />
              </div>
              <nav className="nav">
                {DEVELOPER.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} onNavigate={close} />
                ))}
                <Link href="/#developers">
                  <Icon name="ext" />
                  <span>API reference</span>
                </Link>
              </nav>
            </>
          )}
          <div className="sidefoot">
            <nav className="nav">
              <NavLink
                item={{ href: "/wallet/account", label: "Account", icon: "sliders" }}
                pathname={pathname}
                onNavigate={close}
              />
            </nav>
            <ThemeSwitch />
            <div className="me">
              <Avatar name={name} photo={me.data?.photo_url} />
              <div style={{ flex: 1 }}>
                <b>{me.data?.display_name || "Signed in"}</b>
                <span>{me.data?.near_account ?? " "}</span>
              </div>
              <button
                type="button"
                className="iconbtn"
                aria-label="Sign out"
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
              >
                <Icon name="logout" size={18} />
              </button>
            </div>
          </div>
        </aside>
        <div style={{ minWidth: 0 }}>
          <header className="mtop">
            <Link className="mark" href="/wallet">
              <img src="/app/mark.webp" alt="" />
              <b>fliq</b>
            </Link>
            <button type="button" className="iconbtn" aria-label="Open menu" onClick={() => setMenu(true)}>
              <Icon name="menu" />
            </button>
          </header>
          <main className="main" id="main">
            {signedOut || unclaimed ? null : children}
          </main>
          <nav className="tabbar" aria-label="Quick">
            {tabs.map((item) => (
              <Link key={item.href} href={item.href} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
                <Icon name={item.icon} />
                <span>{item.short ?? item.label}</span>
              </Link>
            ))}
            <button type="button" onClick={() => setMenu(true)}>
              <Icon name="menu" />
              <span>More</span>
            </button>
          </nav>
        </div>
      </div>
      {menu && <div className="scrim" style={{ zIndex: 55 }} onClick={close} />}
    </>
  );
}
