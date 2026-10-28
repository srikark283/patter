import { Monitor, Sun, Moon } from "lucide-react";
import { setTheme, useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const choices = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const satisfies readonly { value: Theme; label: string; icon: typeof Monitor }[];

export function ThemeSwitcher() {
  const theme = useTheme();
  const selected = choices.findIndex(choice => choice.value === theme);

  return <div className="space-y-2">
    <div className="flex items-center justify-between px-1 text-[11px]">
      <span className="text-muted-foreground">Appearance</span>
      <span className="font-medium text-foreground">{choices[selected].label}</span>
    </div>
    <div role="group" aria-label="Appearance" className="relative isolate grid grid-cols-3 rounded-full bg-foreground/[0.04] p-1 ring-1 ring-inset ring-border">
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-1 left-1 rounded-full bg-card shadow-sm transition-transform duration-200 ease-out" style={{ width: "calc((100% - 8px) / 3)", transform: `translateX(${selected * 100}%)` }} />
      {choices.map(({ value, label, icon: Icon }) => <button
        key={value}
        type="button"
        aria-label={`Use ${label.toLowerCase()} theme`}
        aria-pressed={theme === value}
        title={value === "system" ? "Follow system appearance" : `Use ${label.toLowerCase()} theme`}
        onClick={() => setTheme(value)}
        className={cn("relative z-10 flex h-7 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", theme === value ? "text-accent-foreground" : "text-muted-foreground hover:text-foreground")}
      ><Icon size={15} strokeWidth={theme === value ? 2 : 1.6} /></button>)}
    </div>
  </div>;
}
