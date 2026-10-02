import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "Katapatha",
  description:
    "One delivery operation, four role-specific workspaces. The mirror metaphor Waypoint Group runs its mornings on.",
};

const ROLES = [
  {
    title: "Store manager",
    scope: "One outlet",
    device: "Phone or counter PC",
    does: "Places orders before the 16:00 cutoff; confirms what actually turned up.",
    home: "/store",
  },
  {
    title: "Dispatcher",
    scope: "One depot",
    device: "Dense desktop",
    does:
      "Closes the queue; runs the allocator; confirms every deferral with a reason; publishes.",
    home: "/dispatcher",
  },
  {
    title: "Loader",
    scope: "One depot",
    device: "Shared dock tablet",
    does: "Checks each line onto the vehicle; raises shortfalls; releases ready trips.",
    home: "/loader",
  },
  {
    title: "Driver",
    scope: "One vehicle",
    device: "Phone, patchy signal",
    does: "Claims a vehicle; records arrival, unload, and delivery with proof.",
    home: "/driver",
  },
] as const;

export default function Home() {
  const showAccess = process.env.NODE_ENV !== "production";

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <section className="relative overflow-hidden border-b border-line bg-[color:var(--c-navy)] text-white">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-5 py-14 sm:px-8 lg:py-20">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <Image
              src="/logo/katapatha-lockup-light.png"
              alt="Katapatha"
              width={1600}
              height={409}
              priority
              className="h-auto w-40"
            />
            <nav className="flex items-center gap-3">
              {showAccess && (
                <Link
                  href="/access"
                  className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-white/30 bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/20"
                >
                  Reviewer access
                </Link>
              )}
              <Link
                href="/sign-in"
                className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink hover:brightness-95"
              >
                Sign in
              </Link>
            </nav>
          </header>

          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/70">
              Katapatha · the mirror
            </p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              One delivery morning,
              <br />
              seen from four sides at once.
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-white/80">
              Katapatha carries each operational decision, its reason, and its outcome from
              ordering through planning, loading, delivery, and store receipt — so dispatch,
              dock, road, and store teams work from the same record of a day that is still
              in progress.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-5 py-14 sm:px-8">
        <h2 className="text-2xl font-semibold text-ink">Four workspaces, one delivery story</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Each role sees exactly what it needs to decide the next action, and the state the
          other three recorded before it. Scope is enforced per record — a dispatcher is
          bound to one depot, a store manager to one outlet, a driver to one vehicle.
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {ROLES.map((role) => (
            <li key={role.title}>
              <Link
                href={role.home}
                className="group flex h-full flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-5 transition-colors hover:border-[color:var(--c-navy)] focus-visible:border-[color:var(--c-navy)]"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {role.scope} · {role.device}
                </p>
                <p className="text-xl font-semibold text-ink">{role.title}</p>
                <p className="text-sm text-muted">{role.does}</p>
                <p className="mt-auto text-sm font-semibold text-link group-hover:underline">
                  Open workspace →
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <footer className="border-t border-line bg-raised">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted sm:px-8">
          <p>Delivery coordination for Waypoint Group · built for the Techtriathlon.</p>
          <p>
            See{" "}
            <code className="rounded bg-surface px-1.5 py-0.5 text-xs text-ink">docs/</code>{" "}
            in the repository for the product and design briefs this interface answers to.
          </p>
        </div>
      </footer>
    </main>
  );
}
