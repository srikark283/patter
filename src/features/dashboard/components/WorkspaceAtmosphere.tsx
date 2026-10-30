import { useEffect, useState } from "react";

/** Slow light at the workspace edges, independent of recording activity. */
export function WorkspaceAtmosphere() {
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return <div className="workspace-atmosphere" data-paused={!visible || undefined} aria-hidden="true"><span /><span /></div>;
}
