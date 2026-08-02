// rdev's stored key names are platform-neutral identifiers ("AltGr", "Super",
// "ControlLeft"...) — display them using the labels each OS actually uses.
//
// Lives here rather than in a view because three screens render the same
// hotkey: Preferences, the dashboard status pill, and onboarding. Two of them
// used to print the raw identifier, so the same key read as "Left Control" on
// one screen and "ControlLeft" on another.

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");

const KEY_LABELS: Record<string, [mac: string, other: string]> = {
  Alt: ["Option", "Alt"],
  AltGr: ["Right Option", "Right Alt"],
  Super: ["Command", "Win"],
  Control: ["Control", "Ctrl"],
  Shift: ["Shift", "Shift"],
  ControlLeft: ["Left Control", "Left Ctrl"],
  ControlRight: ["Right Control", "Right Ctrl"],
  ShiftLeft: ["Left Shift", "Left Shift"],
  ShiftRight: ["Right Shift", "Right Shift"],
  MetaLeft: ["Left Command", "Left Win"],
  MetaRight: ["Right Command", "Right Win"],
  Space: ["Space", "Space"],
};

/** One key's display label. Unknown keys (letters, F-keys) pass through. */
export function formatKey(part: string): string {
  return KEY_LABELS[part]?.[IS_MAC ? 0 : 1] ?? part;
}

/** A whole combo as a single string, e.g. "Left Control + Space". */
export function formatHotkey(combo: string): string {
  return combo.split("+").map(formatKey).join(" + ");
}
