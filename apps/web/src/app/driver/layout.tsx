import { requireRole } from "@/lib/auth";
import { ConnectivityProvider } from "./connectivity";
import { PositionShareProvider } from "./position-control";

export const metadata = {
  title: "Driver · Katapatha",
  description: "Driver run and delivery recording for Waypoint Group.",
};

/**
 * The web driver is a fallback for the native app, so it is held to the same
 * bar: a phone-width column, a night rendering, and honest connectivity.
 *
 * `data-night="auto"` is what opts this subtree into the night palette (see
 * docs/DESIGN.md); the rest of the product never carries it. A layout cannot
 * guard a server action, so each action re-checks the session itself; this
 * guard is for the pages.
 */
export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  await requireRole("DRIVER", "/driver");

  return (
    <div data-night="auto" className="min-h-screen bg-canvas text-ink">
      <ConnectivityProvider>
        <PositionShareProvider>{children}</PositionShareProvider>
      </ConnectivityProvider>
    </div>
  );
}
