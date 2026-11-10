"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "./icons";

export type ThemeChoice = "light" | "dark" | "system";

const KEY = "fliq-theme";
const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {}
  if (choice === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", choice);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  return useSyncExternalStore(subscribe, read, () => "system" as ThemeChoice);
}

const CHOICES: { value: ThemeChoice; icon: "sun" | "moon" | "monitor"; label: string }[] = [
  { value: "light", icon: "sun", label: "Light" },
  { value: "dark", icon: "moon", label: "Dark" },
  { value: "system", icon: "monitor", label: "System" },
];

export function ThemeSwitch({ labels = false }: { labels?: boolean }) {
  const theme = useTheme();
  return (
    <div className="seg" role="group" aria-label="Appearance" style={labels ? { width: 240 } : undefined}>
      {CHOICES.map(({ value, icon, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={theme === value}
          aria-label={labels ? undefined : `${label} theme`}
          onClick={() => setTheme(value)}
        >
          <Icon name={icon} size={labels ? 15 : 16} />
          {labels && label}
        </button>
      ))}
    </div>
  );
}
