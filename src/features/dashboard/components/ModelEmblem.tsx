import { useId } from "react";

/** Shared orbital geometry: one focused orbit for Nano, three for Mini. */
export function ModelEmblem({ model }: { model: "patter-1-nano" | "patter-1-mini" }) {
  const mini = model === "patter-1-mini";
  const id = useId().replace(/:/g, "");
  const ring = `${id}-ring`;
  const core = `${id}-core`;
  return <span className="model-emblem" data-tone={mini ? "intelligence" : "voice"} title={mini ? "Mini · Atomic orbitals" : "Nano · Atomic orbital"}>
    <svg width="36" height="36" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={ring} x1="5" y1="34" x2="34" y2="6" gradientUnits="userSpaceOnUse">
          <stop stopColor={mini ? "#6457c5" : "#168497"} /><stop offset=".5" stopColor={mini ? "#9b92e4" : "#49b9bd"} /><stop offset="1" stopColor={mini ? "#d6ae82" : "#92e5d8"} />
        </linearGradient>
        <radialGradient id={core} cx=".3" cy=".23" r=".8">
          <stop stopColor="#d4fff3" /><stop offset=".4" stopColor="#75dcd4" /><stop offset="1" stopColor="#218caa" />
        </radialGradient>
      </defs>
      <g className="emblem-orbits">
        {mini ? <>
          <g stroke={`url(#${ring})`} strokeWidth="2.1">
            <ellipse cx="20" cy="20" rx="17" ry="10" transform="rotate(-30 20 20)" />
            <ellipse cx="20" cy="20" rx="17" ry="10" transform="rotate(30 20 20)" />
            <ellipse cx="20" cy="20" rx="17" ry="10" transform="rotate(90 20 20)" strokeOpacity=".75" />
          </g>
          <path d="m20 11 8 7-3 9H15l-3-9 8-7Z" fill="#7869cc" />
          <path d="m20 11 0 9-8-2 8-7Z" fill="#c7ccfa" />
          <path d="m20 11 8 7-8 2v-9Z" fill="#e6c298" />
          <path d="m12 18 8 2-5 7-3-9Z" fill="#6578d7" />
          <path d="m28 18-8 2 5 7 3-9Z" fill="#a17fc8" />
          <path d="m20 20 5 7H15l5-7Z" fill="#534c9e" />
        </> : <>
          <ellipse cx="20" cy="20" rx="19" ry="6.8" transform="rotate(-48 20 20)" stroke={`url(#${ring})`} strokeWidth="1.3" />
          <circle cx="20" cy="20" r="9" fill={`url(#${core})`} />
          {/* The near half crosses in front of the core for a continuous orbit. */}
          <path d="M1 20a19 6.8 0 0 0 38 0" transform="rotate(-48 20 20)" stroke={`url(#${ring})`} strokeWidth="1.5" strokeLinecap="round" />
        </>}
      </g>
    </svg>
  </span>;
}
