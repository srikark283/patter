import { Check, Loader2 } from "lucide-react";

export function StageProgress({ steps, current, complete = false, label }: { steps: string[]; current: number; complete?: boolean; label: string }) {
  return <ol aria-label={label} className="stage-progress">
    {steps.map((step, index) => {
      const done = complete || index < current;
      const active = !complete && index === current;
      return <li key={step} aria-current={active ? "step" : undefined} className={done ? "is-complete" : active ? "is-current" : ""}>
        <span className="stage-mark" aria-hidden="true">{done ? <Check size={12} /> : active ? <Loader2 size={12} className="animate-spin" /> : <span className="size-1 rounded-full bg-current" />}</span>
        <span>{step}</span><span className="sr-only">{done ? ", complete" : active ? ", in progress" : ", pending"}</span>
      </li>;
    })}
  </ol>;
}
