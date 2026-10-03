import type { ReactNode } from "react";

/**
 * The pinned thumb bar. It holds ONE dominant action (the flame button) and at
 * most one quieter one beside it. Pages that use it add `pb-44` so the last
 * card is never hidden behind it.
 */
export function ThumbBar({ children, notice }: { children: ReactNode; notice?: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface shadow-[0_-4px_12px_rgb(0_0_0/0.06)]">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-2 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
        {notice}
        <div className="flex items-stretch gap-3">{children}</div>
      </div>
    </div>
  );
}
