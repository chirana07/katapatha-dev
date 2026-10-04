import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { signInAs, type AccessState } from "./actions";
import { AccessButton } from "./access-button";

export const metadata = {
  title: "Reviewer access · Katapatha",
  description:
    "Development-only demo accounts. Each button signs in and lands on the matching role's workspace.",
};

/**
 * Development-only demo switcher. PRODUCT.md:
 *   "Temporary usernames, passwords, challenge notes, and prototype
 *    instructions belong on the development-only /access page."
 *
 * The page returns 404 in production. The accounts shown here are the
 * seed users created by apps/api/prisma/seed/users.ts; the shared password
 * `waypoint` matches the seed and nothing else.
 */
export const dynamic = "force-dynamic";

const ACCOUNTS = [
  {
    role: "Store manager",
    email: "fathima@waypoint.lk",
    staff: { id: "STR-0074", pin: "9024" },
    scope: "Outlet OUT074 · Fresh Nugegoda",
    device: "Phone or counter PC",
    does: "Place an order, follow the delivery, confirm receipt.",
    home: "/store",
    accent: "border-emerald-200",
  },
  {
    role: "Dispatcher",
    email: "nimal@waypoint.lk",
    staff: { id: "DSP-0101", pin: "2580" },
    scope: "Peliyagoda depot",
    device: "Dense desktop",
    does: "Close the queue, run the allocator, confirm deferrals, publish.",
    home: "/dispatcher",
    accent: "border-amber-200",
  },
  {
    role: "Loader",
    email: "ranjith@waypoint.lk",
    scope: "Peliyagoda depot",
    device: "Shared dock tablet",
    does: "Check each line onto the vehicle, raise shortfalls, mark ready.",
    home: "/loader",
    accent: "border-blue-200",
    staff: { id: "LDR-0142", pin: "4826" },
  },
  {
    role: "Driver",
    email: "sunil@waypoint.lk",
    staff: { id: "DRV-0207", pin: "1357" },
    scope: "Claims a vehicle at the dock",
    device: "Phone, patchy signal",
    does: "Arrive, unload, complete with POD, report problems.",
    home: "/driver",
    accent: "border-indigo-200",
  },
  {
    role: "Admin",
    email: "asha@waypoint.lk",
    staff: { id: "ADM-0001", pin: "7531" },
    scope: "Every depot",
    device: "Desktop",
    does: "Add people, outlets and vehicles; compare depots; read the decision log.",
    home: "/admin",
    accent: "border-rose-200",
  },
] as const;

function demoAccessEnabled(): boolean {
  // LEAD scaffolded ALLOW_DEMO_ACCESS=0 in apps/api/.env.example as the
  // explicit opt-in flag for the review accounts. Honour it here so a
  // demo deploy can set the flag without flipping NODE_ENV off production.
  // Also enabled in any non-production build so local dev never needs it.
  return (
    process.env.ALLOW_DEMO_ACCESS === "1" ||
    String(process.env.NODE_ENV) !== "production"
  );
}

export default function AccessPage() {
  if (!demoAccessEnabled()) {
    return notFound();
  }

  const initial: AccessState = {};

  return (
    <main className="min-h-screen bg-canvas p-5 sm:p-8">
      <div className="mx-auto w-full max-w-5xl">
        <nav className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-ink hover:underline">
            ← Back to the landing page
          </Link>
          <Image
            src="/logo/katapatha-lockup-light.png"
            alt="Katapatha"
            width={1600}
            height={417}
            className="h-auto w-28"
          />
        </nav>

        <header className="mt-8 border-b border-line pb-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            Development-only
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Reviewer access
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-muted">
            Four seeded demo accounts, one per role. Tap a card to sign in and land on that
            role&apos;s workspace. Each card shows the staff ID and PIN the real sign-in page asks
            for, so a reviewer can type them there too. This route is removed
            in production builds — the only time it exists is on a seeded local database.
          </p>
        </header>

        <section
          aria-label="Demo accounts"
          className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-2"
        >
          {ACCOUNTS.map((account) => (
            <article
              key={account.email}
              className={`flex flex-col gap-3 rounded-[var(--radius-card)] border bg-surface p-5 ${account.accent}`}
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {account.scope} · {account.device}
                </p>
                <p className="mt-1 text-xl font-semibold text-ink">{account.role}</p>
                <p className="mt-1 text-sm text-muted">{account.does}</p>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-line bg-raised p-3 text-sm">
                <dt className="font-semibold text-muted">Staff ID</dt>
                <dd className="tabular text-ink">{account.staff.id}</dd>
                <dt className="font-semibold text-muted">PIN</dt>
                <dd className="tabular text-ink">{account.staff.pin}</dd>
                <dt className="font-semibold text-muted">Lands on</dt>
                <dd className="text-ink">{account.home}</dd>
              </dl>
              <AccessButton
                action={signInAs}
                email={account.email}
                home={account.home}
                initial={initial}
              />
            </article>
          ))}
        </section>

        <aside className="mt-8 rounded-[var(--radius-card)] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">For reviewers only.</p>
          <p className="mt-1">
            This page assumes the local seed from{" "}
            <code className="rounded bg-amber-100 px-1">pnpm db:seed</code>. Credentials
            are the seed defaults and never work against a production database — the
            seed itself refuses to run with real customer data. Nothing on this page is
            a security claim; it is the opposite, a convenience that is removed from the
            production bundle.
          </p>
        </aside>
      </div>
    </main>
  );
}
