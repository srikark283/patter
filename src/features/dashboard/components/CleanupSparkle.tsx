import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";

/** A quiet activity cue; the adjacent text carries the actual status. */
export function CleanupSparkle({ complete = false }: { complete?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref);
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return <svg ref={ref} className="cleanup-sparkle" data-complete={complete || undefined} data-running={inView && visible || undefined} width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
    <path d="m12 7 1.8 5.2L19 14l-5.2 1.8L12 21l-1.8-5.2L5 14l5.2-1.8L12 7Z" />
    <path d="m21 3 .9 2.6L24.5 6.5l-2.6.9L21 10l-.9-2.6-2.6-.9 2.6-.9L21 3Z" />
    <path d="m22 19 .7 2.3 2.3.7-2.3.7L22 25l-.7-2.3L19 22l2.3-.7L22 19Z" />
  </svg>;
}
