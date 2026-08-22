import { ComponentType } from "react";
import { cn } from "@/lib/utils";

/** The round icon chip on a settings row.
 *
 *  Colour here is earned, never decorative: a chip tints only while its setting
 *  is actually doing something. Ten hand-picked hues down a settings page read
 *  as a system control panel and carry no information — one accent that appears
 *  when a thing is live tells you something at a glance.
 */
export function SettingIcon({ icon: Icon, active, size = "sm" }: {
  icon: ComponentType<{ size?: number; className?: string }>;
  /** Configured, enabled, chosen — the only thing that earns accent colour. */
  active?: boolean;
  /** `lg` marks the setting a section is really about. */
  size?: "sm" | "lg";
}) {
  const lg = size === "lg";
  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center shrink-0 transition-colors",
        lg ? "w-9 h-9" : "w-8 h-8",
        active
          ? "bg-accent-strong text-accent-foreground"
          : "bg-foreground/[0.05] text-muted-foreground"
      )}
    >
      <Icon size={lg ? 15 : 14} />
    </div>
  );
}
