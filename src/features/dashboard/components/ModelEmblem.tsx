/** A firefly and lantern share filled silhouettes and a warm amber light. */
export function ModelEmblem({ model }: { model: "patter-1-nano" | "patter-1-mini" }) {
  const mini = model === "patter-1-mini";
  return <span className="model-emblem" data-tone={mini ? "intelligence" : "voice"} title={mini ? "Mini · Lantern" : "Nano · Firefly"}>
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      {mini ? <>
        <path d="M12.5 8V6a3.5 3.5 0 0 1 7 0v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M8 11.8c1.6-3.2 4.6-4.4 8-4.4s6.4 1.2 8 4.4c.3.6-.1 1.2-.8 1.2H8.8c-.7 0-1.1-.6-.8-1.2Z" fill="currentColor" />
        <path d="M10 13.5h12v8.8a2.7 2.7 0 0 1-2.7 2.7h-6.6a2.7 2.7 0 0 1-2.7-2.7v-8.8Z" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeOpacity=".5" strokeWidth=".7" />
        <path d="M8.5 14v9.5M23.5 14v9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M16 15.7c-.3 2.8-3.2 3.7-3.2 6a3.2 3.2 0 1 0 6.4 0c0-2.3-1.6-4-3.2-6Z" className="emblem-lantern-flame" />
        <path d="M14.6 21.2c-.2.9 0 1.6.6 2" stroke="var(--category-surface)" strokeOpacity=".8" strokeWidth=".9" strokeLinecap="round" />
        <rect x="8" y="25" width="16" height="3" rx="1.5" fill="currentColor" />
      </> : <>
        <path d="M14.8 7.1c-.2-1.4-.9-2.3-2-2.8m4.4 2.8c.2-1.4.9-2.3 2-2.8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        <circle cx="16" cy="8.6" r="2" fill="currentColor" />
        <path d="M14.4 11C12.8 8 9.4 6 7.2 7.2 4.5 8.7 6.2 14.6 13.8 17.6c1.2 0 1.7-2.6.6-6.6Z" fill="currentColor" fillOpacity=".24" stroke="currentColor" strokeOpacity=".65" strokeWidth=".7" />
        <path d="M17.6 11C19.2 8 22.6 6 24.8 7.2c2.7 1.5 1 7.4-6.6 10.4-1.2 0-1.7-2.6-.6-6.6Z" fill="currentColor" fillOpacity=".24" stroke="currentColor" strokeOpacity=".65" strokeWidth=".7" />
        <path d="M14 12c0-1.1.9-1.8 2-1.8s2 .7 2 1.8v6h-4v-6Z" fill="currentColor" />
        <path d="M12.8 19.2c0-1.6 1.4-2.4 3.2-2.4s3.2.8 3.2 2.4c0 4.6-1.3 8.1-3.2 9.1-1.9-1-3.2-4.5-3.2-9.1Z" className="emblem-firefly-light" />
        <path d="M14.3 19.7c0 2 .4 3.7.9 4.8" stroke="var(--category-surface)" strokeOpacity=".8" strokeWidth=".9" strokeLinecap="round" />
      </>}
    </svg>
  </span>;
}
