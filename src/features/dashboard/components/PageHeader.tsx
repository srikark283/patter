import { ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  // Hairline + glass only appear once content actually scrolls beneath.
  useEffect(() => {
    const scroller = ref.current?.closest("main");
    if (!scroller) return;
    const onScroll = () => setStuck(scroller.scrollTop > 8);
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        // Negative margins span the main area's px-10/py-9 gutters so the
        // backdrop covers edge-to-edge while content keeps its max-width.
        "sticky top-0 z-20 -mx-10 -mt-9 px-10 pt-9 pb-3 transition-colors duration-200",
        stuck && "bg-background/75 backdrop-blur-xl shadow-[0_1px_0_0_var(--border)]"
      )}
    >
      <div className="flex items-end justify-between">
        <div>
          <h2 className="mt-1.5 text-[24px] font-semibold tracking-tight leading-none">{title}</h2>
          {description && <p className="mt-1.5 text-[14px] text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}
