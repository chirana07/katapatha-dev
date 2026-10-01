import Link from "next/link";

export const metadata = {
  title: "Loader · Katapatha",
  description: "Dock loader workspace for Waypoint Group deliveries.",
};

export default function LoaderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line bg-[color:var(--c-navy)] text-white">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex flex-col">
            <Link href="/loader" className="text-lg font-semibold tracking-tight">
              Katapatha · Loader
            </Link>
            <span className="text-xs text-white/70">Shared dock terminal · Peliyagoda</span>
          </div>
          <nav aria-label="Loader" className="flex items-center gap-2">
            <Link
              href="/loader"
              className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-white/10 px-3 text-sm font-semibold text-white hover:bg-white/20"
            >
              Dock board
            </Link>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
