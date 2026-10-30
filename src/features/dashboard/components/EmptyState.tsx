import { VoiceSignature } from "./VoiceSignature";
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
  preview?: ReactNode;
  voice?: boolean;
}

/// The dashboard's one zero-state. Every view that can be empty renders this
/// so the raised card, icon tile, and copy scale stay in step across Meetings,
/// History, Memory, Macros, and the Dictionary.
export function EmptyState({ icon: Icon, title, description, action, className, preview, voice }: Props) {
  return (
    <Card className={cn("items-center justify-center py-12 px-5 sm:py-16 text-center", className)}>
      {voice && <div className="mb-3 text-accent-foreground"><VoiceSignature /></div>}
      <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-accent-foreground" strokeWidth={1.5} />
      </div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground mt-2 max-w-[380px] leading-relaxed">{description}</p>
      {preview}
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}
