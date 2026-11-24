import { useState } from "react";

/**
 * The theme switch (ADR-0151): system (follow the OS), light or dark. Kept in this browser's local
 * storage only: no server field. Applied as `data-theme` on <html>; the tokens in index.css read
 * it, and with none set they follow `prefers-color-scheme`.
 */

export type Theme = "system" | "light" | "dark";

export const THEMES: readonly { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const STORAGE_KEY = "andy.theme";

/** The remembered choice; system when nothing (or storage) is there. */
export function loadTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** Sets the theme on the page at once. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

/** Applies and remembers the choice. */
export function saveTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    if (theme === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not remembering is fine; the theme still changes for this visit.
  }
}

/** The current choice and a setter that applies and remembers it. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  return [
    theme,
    (next) => {
      saveTheme(next);
      setTheme(next);
    },
  ];
}
