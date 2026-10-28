import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder rows for an editable list while its settings load.
 *
 *  This is a *loading* state, not an empty one — without it the zero-state
 *  onboarding copy flashed on every visit, even for a user with hundreds of
 *  rows. All three list views showed the same five bars, so they share them.
 */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading list" className="space-y-2 mt-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-[52px] w-full rounded-xl" />
      ))}
    </div>
  );
}
