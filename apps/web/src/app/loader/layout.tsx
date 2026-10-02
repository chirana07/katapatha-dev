import Link from "next/link";
import { DockSidebar } from "./dock-sidebar";

export const metadata = {
  title: "Loader · Katapatha",
  description: "Dock loader workspace for Waypoint Group deliveries.",
};

export default function LoaderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <DockSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone / tablet nav bar when the sidebar is hidden. */}
        <header className="flex items-center justify-between gap-3 border-b border-line bg-[color:var(--c-navy)] px-4 py-3 text-white lg:hidden">
          <Link href="/loader" className="text-base font-semibold tracking-tight">
            Katapatha · Loader
          </Link>
          <span className="text-xs text-white/70">Peliyagoda dock</span>
        </header>
        {children}
      </div>
    </div>
  );
}
