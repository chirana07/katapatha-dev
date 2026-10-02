import Link from "next/link";
import { StoreSidebar } from "./store-sidebar";

export const metadata = {
  title: "Store manager · Katapatha",
  description: "Store manager workspace for a Waypoint Group outlet.",
};

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      <StoreSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone/tablet nav bar when the sidebar is hidden. */}
        <header className="flex items-center justify-between gap-3 border-b border-line bg-[color:var(--c-navy)] px-4 py-3 text-white lg:hidden">
          <Link href="/store" className="text-base font-semibold tracking-tight">
            Katapatha · Store
          </Link>
        </header>
        {children}
      </div>
    </div>
  );
}
