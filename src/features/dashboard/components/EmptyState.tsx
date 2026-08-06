import { ElementType, ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  /// Any lucide icon component — rendered at a fixed size inside the tile so
  /// every zero-state reads at the same weight.
  icon: ElementType;
  title: string;
  description: string;
  /// Optional call to action. Views whose zero-state has nothing to click
  /// (history, search misses) just leave it off.
  action?: ReactNode;
  className?: string;
}

/// The dashboard's one zero-state. Every view that can be empty renders this
/// so the raised card, icon tile, and copy scale stay in step across Meetings,
/// History, Memory, Macros, and the Dictionary.
export function EmptyState({ icon: Icon, title, description, action, className }: Props) {
  return (
    <Card className={cn("items-center justify-center py-20 px-4 text-center bg-foreground/[0.01]", className)}>
      <div className="w-12 h-12 rounded-xl bg-foreground/[0.04] ring-1 ring-border flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-muted-foreground" strokeWidth={1.5} />
      </div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground mt-2 max-w-[380px] leading-relaxed">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}
