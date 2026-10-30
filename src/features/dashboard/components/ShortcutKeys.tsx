import { useEffect, useState } from "react";
import { formatHotkey, formatKey, IS_MAC } from "@/lib/hotkey";
const SYMBOLS: Record<string, string> = { Alt: "⌥", AltGr: "⌥", Super: "⌘", MetaLeft: "⌘", MetaRight: "⌘", Control: "⌃", ControlLeft: "⌃", ControlRight: "⌃", Shift: "⇧", ShiftLeft: "⇧", ShiftRight: "⇧" };
const KEY_CODES: Record<string, string> = { Alt: "AltLeft", AltGr: "AltRight", Super: "Meta", Control: "Control", Shift: "Shift" };
export function ShortcutKeys({ combo, pressed = false, interactive = false }: { combo: string; pressed?: boolean; interactive?: boolean }) {
  const [held, setHeld] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!interactive) return;
    const down = (event: KeyboardEvent) => setHeld(keys => new Set(keys).add(event.code));
    const up = (event: KeyboardEvent) => setHeld(keys => { const next = new Set(keys); next.delete(event.code); return next; });
    const reset = () => setHeld(new Set());
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", reset);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", reset); };
  }, [interactive]);
  const isHeld = (part: string) => [...held].some(code => KEY_CODES[part] ? code.startsWith(KEY_CODES[part]) : code === part || code === `Key${part}` || code === `Digit${part}`);
  return <span className="shortcut-keys" aria-label={formatHotkey(combo)}>{combo.split("+").map((part, index) => <kbd key={`${part}-${index}`} className="shortcut-key" data-pressed={pressed || isHeld(part) || undefined} title={formatKey(part)} aria-hidden="true">{IS_MAC && SYMBOLS[part] ? <>{/Right$/.test(part) || part === "AltGr" ? <small>R</small> : /Left$/.test(part) ? <small>L</small> : null}{SYMBOLS[part]}</> : formatKey(part)}</kbd>)}</span>;
}
