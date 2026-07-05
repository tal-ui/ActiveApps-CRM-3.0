// Theme store — dark (default) / light, persisted to localStorage and
// applied via the `data-theme` attribute on <html>. The initial attribute is
// set by an inline script in index.html to avoid a flash on first paint.
import { useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";

export type Theme = "dark" | "light";

const STORAGE_KEY = "aa-crm-theme";
const listeners = new Set<() => void>();

// In the native iOS app the status bar doesn't follow the web theme on its
// own — keep it in sync. No-op in browsers (isNativePlatform is false).
function syncNativeStatusBar(theme: Theme): void {
  if (!Capacitor.isNativePlatform()) return;
  import("@capacitor/status-bar")
    .then(({ StatusBar, Style }) =>
      StatusBar.setStyle({
        style: theme === "light" ? Style.Light : Style.Dark,
      }),
    )
    .catch(() => {
      /* plugin unavailable — non-fatal */
    });
}

export function getTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme): void {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable — non-fatal */
  }
  syncNativeStatusBar(theme);
  listeners.forEach((l) => l());
}

// Align the native status bar with the persisted theme on app launch
syncNativeStatusBar(getTheme());

export function toggleTheme(): void {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}

/** React hook: returns the current theme and re-renders on change. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getTheme,
    () => "dark",
  );
}
