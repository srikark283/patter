import { useEffect, useRef, useState } from "react";
import type { TranscriptionRecord } from "@/types";
export function useNewTranscript(history: TranscriptionRecord[] | null) {
  const known = useRef<Set<string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [freshId, setFreshId] = useState<string | null>(null);
  useEffect(() => {
    if (!history) return;
    const fresh = known.current && history.find(record => !known.current!.has(record.id));
    known.current = new Set(history.map(record => record.id));
    if (fresh) {
      clearTimeout(timer.current);
      setFreshId(fresh.id);
      timer.current = setTimeout(() => setFreshId(null), 2200);
    }
  }, [history]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return freshId;
}
