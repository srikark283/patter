// Appearance for the dashboard window. The HUD is deliberately excluded —
// hud.html hardcodes `class="dark"` because it is a floating overlay pill, and
// those stay dark on macOS regardless of system appearance.
//
// Persisted in localStorage rather than the Settings DB for now: this is a
// window-chrome preference, not app behaviour, and keeping it out of Settings
// avoids a Rust round-trip on every dashboard paint. Move it into Settings if
// it ever needs to be read from the tray or synced across windows.

export type Theme = "system" | "light" | "dark";

const KEY = "patter-theme";

export function getTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

/** Resolves "system" against the OS and puts `.dark` on <html> to match. */
export function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setTheme(theme: Theme) {
  if (theme === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

/** Keeps "system" live if the OS flips while the window is open. */
export function watchSystemTheme() {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getTheme() === "system") applyTheme("system");
  });
}
