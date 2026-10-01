import Link from "next/link";
import { Connectivity } from "./connectivity";

export const metadata = {
  title: "Driver · Katapatha",
  description: "Driver run and delivery recording for Waypoint Group.",
};

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-[color:var(--c-navy)] text-white">
        <div className="mx-auto flex w-full max-w-xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <Link href="/driver" className="truncate text-base font-semibold tracking-tight">
              Katapatha · Driver
            </Link>
            <span className="truncate text-xs text-white/70">On the road · Peliyagoda</span>
          </div>
          <Connectivity />
        </div>
      </header>
      {children}
    </div>
  );
}
