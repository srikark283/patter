import { toast } from "sonner";
import { Zap, Keyboard } from "lucide-react";
import { setOutputMode as setOutputModeIpc } from "../../../lib/ipc";
import { PageHeader } from "../components/PageHeader";
import { cn } from "@/lib/utils";

const MODES = [
  {
    id: "paste",
    icon: Zap,
    label: "Instant Paste",
    detail: "Copies to clipboard and simulates Cmd+V — fastest",
  },
  {
    id: "type",
    icon: Keyboard,
    label: "Simulate Typing",
    detail: "Injects keystrokes sequentially — best for remote desktop",
  },
];

interface Props {
  outputMode: string;
  setOutputMode: (mode: string) => void;
}

export function PreferencesView({ outputMode, setOutputMode }: Props) {
  const handleSetOutputMode = async (mode: string) => {
    try {
      await setOutputModeIpc(mode);
      setOutputMode(mode);
      toast.success(`Output mode set to ${MODES.find((m) => m.id === mode)?.label ?? mode}`);
    } catch (e) {
      console.error(e);
      toast.error("Failed to update output mode: " + e);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader title="Settings" description="How Patter delivers text into the frontmost app." />

      <section>
        <span className="t-label block px-1 pb-2.5">Output Mode</span>
        <div className="grid grid-cols-2 gap-3">
          {MODES.map(({ id, icon: Icon, label, detail }) => {
            const selected = outputMode === id;
            return (
              <button
                key={id}
                onClick={() => handleSetOutputMode(id)}
                className={cn(
                  "group relative rounded-xl p-5 text-left ring-1 transition-all duration-150 cursor-pointer",
                  selected
                    ? "bg-steel/[0.08] ring-steel/40 shadow-[0_0_20px_rgba(91,155,209,0.12)]"
                    : "bg-card ring-border hover:ring-white/15 hover:bg-white/[0.03]"
                )}
              >
                <span
                  className={cn(
                    "absolute top-4 right-4 w-2 h-2 rounded-full transition-all",
                    selected ? "bg-steelIce shadow-[0_0_8px_var(--color-steel)]" : "bg-white/10"
                  )}
                />
                <Icon
                  size={17}
                  strokeWidth={1.8}
                  className={selected ? "text-steelIce" : "text-muted-foreground"}
                />
                <p className={cn("mt-3 text-[13px] font-semibold", selected ? "text-foreground" : "text-foreground/85")}>
                  {label}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
