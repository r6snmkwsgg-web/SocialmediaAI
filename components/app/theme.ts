"use client";

export type Theme = "system" | "light" | "dark";

/**
 * Light, dark, or whatever the device does: put on the app straight away
 * and saved in a cookie so the next page loads right. Anything showing the
 * choice hears about it.
 */
export function applyTheme(t: Theme) {
  const el = document.querySelector<HTMLElement>(".app");
  if (el) {
    if (t === "system") delete el.dataset.theme;
    else el.dataset.theme = t;
  }
  document.cookie = `hl_theme=${t}; path=/; max-age=31536000; samesite=lax`;
  window.dispatchEvent(new CustomEvent("hl:theme", { detail: t }));
}
