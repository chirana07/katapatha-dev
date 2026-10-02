import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "Katapatha — one shared truth for every delivery",
  description:
    "One operational record moves with every delivery, from the dispatcher's desk to the loading dock, to the driver's phone, and into the store manager's receipt.",
};

const ROLES = [
  {
    number: "01",
    title: "Dispatcher",
    scope: "Peliyagoda planning office",
    does:
      "Turn confirmed orders into a plan the whole team can trust. Every allocation carries its reason.",
    home: "/dispatcher",
    icon: "dispatcher" as const,
  },
  {
    number: "02",
    title: "Loader",
    scope: "Peliyagoda dock · shared tablet",
    does:
      "Load each stop in the right order and flag shortages before departure.",
    home: "/loader",
    icon: "loader" as const,
  },
  {
    number: "03",
    title: "Driver",
    scope: "On the road · phone · night conditions",
    does:
      "See the next stop and record what happened, even through a signal gap.",
    home: "/driver",
    icon: "driver" as const,
  },
  {
    number: "04",
    title: "Store manager",
    scope: "OUT074, Pettawa · phone or counter PC",
    does:
      "Know when stock is coming, place tomorrow's order, and confirm receipt.",
    home: "/store",
    icon: "store" as const,
  },
] as const;

const TIMELINE = [
  { stage: "Plan", time: "16:30", note: "Every allocation carries its reason." },
  { stage: "Load", time: "01:32", note: "Shortages are visible before departure." },
  { stage: "Deliver", time: "07:04", note: "Actual counts stay with every stop." },
  { stage: "Confirm", time: "08:10", note: "Receipt closes the same record." },
] as const;

const LAMP_MODE = [
  { number: "01", role: "Driver", text: "Records work on the phone while offline." },
  { number: "02", role: "Dispatcher", text: "Sees the age of the last reliable update." },
  { number: "03", role: "Store", text: "Plans staff around an honest ETA range." },
] as const;

function RoleIcon({ kind }: { kind: "dispatcher" | "loader" | "driver" | "store" }) {
  const common = "h-5 w-5";
  if (kind === "dispatcher")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden="true">
        <rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" />
      </svg>
    );
  if (kind === "loader")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden="true">
        <path d="M4 7h11v9H4z" /><path d="M15 10h4l2 3v3h-6" /><circle cx="7.5" cy="18.5" r="1.5" /><circle cx="17" cy="18.5" r="1.5" />
      </svg>
    );
  if (kind === "driver")
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden="true">
        <rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={common} aria-hidden="true">
      <path d="M3 9l1.5-4h15L21 9" /><path d="M3 9h18v11H3z" /><path d="M9 20v-5h6v5" />
    </svg>
  );
}

export default function Home() {
  const showAccess =
    process.env.ALLOW_DEMO_ACCESS === "1" ||
    String(process.env.NODE_ENV) === "development" ||
    String(process.env.NODE_ENV) === "test";

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Image
            src="/logo/katapatha-lockup-dark.png"
            alt="Katapatha"
            width={1600}
            height={409}
            priority
            className="h-auto w-36"
          />
          <nav className="flex items-center gap-5 text-sm text-ink">
            <a href="#product" className="hidden hover:text-link sm:inline">Product</a>
            <a href="#workflow" className="hidden hover:text-link sm:inline">Workflow</a>
            <a href="#lamp-mode" className="hidden hover:text-link sm:inline">Lamp Mode</a>
            {showAccess && (
              <Link href="/access" className="hidden rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-sm hover:bg-raised sm:inline">
                Reviewer access
              </Link>
            )}
            <Link
              href="/sign-in"
              className="inline-flex min-h-10 items-center gap-1 rounded-[var(--radius-control)] bg-[color:var(--c-navy)] px-4 text-sm font-semibold text-white hover:brightness-110"
            >
              Sign in <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </div>
      </header>

      <section
        className="relative overflow-hidden bg-[color:var(--c-navy)] text-white"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at 85% 15%, rgba(246,183,35,0.18), transparent 55%), radial-gradient(ellipse at 20% 90%, rgba(246,183,35,0.08), transparent 55%)",
        }}
      >
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:py-24">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/80">
              <span className="h-1.5 w-1.5 rounded-full bg-action" />
              Waypoint delivery operations
            </p>
            <h1 className="mt-5 text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              One shared truth
              <br />
              <span className="text-action">for every delivery.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-white/80">
              Plan, load, deliver, and receive from one connected record built around the
              people doing the work.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/sign-in"
                className="inline-flex min-h-12 items-center gap-2 rounded-[var(--radius-control)] bg-action px-5 text-base font-semibold text-ink hover:brightness-95"
              >
                Open your workspace <span aria-hidden="true">→</span>
              </Link>
              <a
                href="#workflow"
                className="inline-flex min-h-12 items-center gap-2 rounded-[var(--radius-control)] border border-white/30 px-5 text-base font-semibold text-white hover:bg-white/10"
              >
                Explore the product <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>

          <div className="relative hidden lg:block">
            <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-6 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
                Live plan · Peliyagoda
              </p>
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-md bg-white/10 p-3">
                  <p className="text-xs text-white/60">Orders</p>
                  <p className="tabular mt-1 text-2xl font-semibold">120</p>
                  <p className="mt-1 text-xs text-white/60">96 allocated · 18 deferred</p>
                </div>
                <div className="rounded-md bg-white/10 p-3">
                  <p className="text-xs text-white/60">Vehicles</p>
                  <p className="tabular mt-1 text-2xl font-semibold">60</p>
                  <p className="mt-1 text-xs text-white/60">16 reefers · 44 ambient</p>
                </div>
                <div className="rounded-md bg-white/10 p-3">
                  <p className="text-xs text-white/60">Routes</p>
                  <p className="tabular mt-1 text-2xl font-semibold">10</p>
                  <p className="mt-1 text-xs text-white/60">484 km today</p>
                </div>
              </div>
              <div className="mt-5 rounded-md bg-[color:var(--c-navy)] p-4 text-xs">
                <p className="font-semibold text-action">Work continues through a signal gap</p>
                <p className="mt-1 text-white/70">
                  Driver VEH014 recorded three stops offline. Reconciles automatically on reconnect.
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-white/60">
                <span>12 stops</span>
                <div className="mx-3 h-1 flex-1 rounded-full bg-white/10">
                  <div className="h-full w-[75%] rounded-full bg-action" />
                </div>
                <span>75%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="product" className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--c-ruby)]">
              Designed for Sri Lanka&apos;s delivery reality
            </p>
            <h2 className="mt-3 text-4xl font-semibold leading-tight tracking-tight text-ink">
              The whole route,
              <br />reflected clearly.
            </h2>
            <p className="mt-6 max-w-md text-base text-muted">
              <strong className="text-ink">Katapatha</strong> brings together two ideas:
              the <em>mirror</em>, reflecting every delivery in real time, and{" "}
              <em>patha</em>, representing the traditional paper trail. It transforms that
              paper trail into a living digital record, connecting every update and
              handoff. Its four overlapping forms represent the Dispatcher, Loader,
              Driver, and Store Manager, united as one shared digital truth.
            </p>
          </div>
          <div className="grid grid-cols-4 grid-rows-2 gap-2" aria-hidden="true">
            {[
              "var(--c-flame)",
              "var(--c-ruby)",
              "var(--c-navy)",
              "var(--c-brand-fresh)",
              "var(--c-ochre)",
              "var(--c-crimson)",
              "var(--c-brand-fresh)",
              "var(--c-ink)",
            ].map((bg, i) => (
              <div key={i} className="aspect-square rounded-md" style={{ background: bg }} />
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="mx-auto w-full max-w-6xl px-5 pb-16 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr] lg:items-end">
          <h3 className="text-3xl font-semibold leading-tight tracking-tight text-ink">
            One delivery record moves with the work.
          </h3>
          <p className="text-base text-muted lg:pb-2">
            A shortage, route delay, or receipt stays attached to its time, reason, and
            owner. The next person sees what changed and what to do next.
          </p>
        </div>
        <div className="mt-8 grid gap-4 rounded-[var(--radius-card)] bg-[color:var(--c-navy)] p-6 text-white sm:grid-cols-4">
          {TIMELINE.map((row, i) => (
            <div key={row.stage} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-sm bg-action text-xs font-semibold text-ink">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="text-xs font-semibold uppercase tracking-wide text-white/70">
                  {row.stage}
                </p>
              </div>
              <p className="tabular text-3xl font-semibold">{row.time}</p>
              <p className="text-xs text-white/70">{row.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 pb-20 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--c-ruby)]">
              A focused view for every responsibility
            </p>
            <h3 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-ink">
              Four roles. One connected operation.
            </h3>
          </div>
          <Link href="/sign-in" className="text-sm font-semibold text-link hover:underline">
            Choose a workspace →
          </Link>
        </div>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((role) => (
            <li key={role.title}>
              <Link
                href={role.home}
                className="group flex h-full flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5 transition-colors hover:border-[color:var(--c-navy)]"
              >
                <div className="flex items-start justify-between">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-action/15 text-[color:var(--c-navy)]">
                    <RoleIcon kind={role.icon} />
                  </span>
                  <span className="text-xs font-semibold text-muted">{role.number}</span>
                </div>
                <p className="text-lg font-semibold text-ink">{role.title}</p>
                <p className="text-xs text-muted">{role.scope}</p>
                <p className="mt-1 text-sm text-muted">{role.does}</p>
                <p className="mt-auto pt-2 text-sm font-semibold text-link group-hover:underline">
                  Continue to sign in →
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section id="lamp-mode" className="mx-auto w-full max-w-6xl px-5 pb-20 sm:px-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--c-ruby)]">
              Designed for the day it breaks
            </p>
            <h3 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-ink">
              When the signal goes,
              <br />the handoff stays.
            </h3>
            <p className="mt-4 max-w-md text-sm text-muted">
              Lamp Mode preserves the driver&apos;s local record, shows dispatch the last
              reliable update, and gives the store an honest arrival range.
            </p>
            <Link
              href="/driver"
              className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] bg-[color:var(--c-navy)] px-4 text-sm font-semibold text-white hover:brightness-110"
            >
              Open driver workspace <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="grid gap-3 rounded-[var(--radius-card)] bg-[color:var(--c-navy)] p-6 text-white sm:grid-cols-3">
            {LAMP_MODE.map((row) => (
              <div key={row.role} className="rounded-md bg-white/5 p-4">
                <p className="text-xs font-semibold text-action">{row.number}</p>
                <p className="mt-2 text-base font-semibold">{row.role}</p>
                <p className="mt-1 text-xs text-white/70">{row.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 pb-20 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-5 rounded-[var(--radius-card)] bg-action p-8 text-ink">
          <div>
            <h3 className="text-2xl font-semibold leading-tight tracking-tight">
              Start with the workspace built for your shift.
            </h3>
            <p className="mt-2 max-w-xl text-sm">
              Your role, priorities, and next action are already in focus.
            </p>
          </div>
          <Link
            href="/sign-in"
            className="inline-flex min-h-12 items-center gap-2 rounded-[var(--radius-control)] bg-[color:var(--c-navy)] px-5 text-base font-semibold text-white hover:brightness-110"
          >
            Sign in to Katapatha <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <footer className="border-t border-line bg-[color:var(--c-navy)] text-white/80">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm sm:px-8">
          <Image
            src="/logo/katapatha-lockup-light.png"
            alt="Katapatha"
            width={1600}
            height={409}
            className="h-auto w-32"
          />
          <nav className="flex flex-wrap items-center gap-5 text-sm">
            <a href="#product" className="hover:text-white">Product</a>
            <a href="#workflow" className="hover:text-white">Workflow</a>
            {showAccess && (
              <Link href="/access" className="hover:text-white">Access centre</Link>
            )}
            <span className="text-white/60">Katapatha by Waypoint Group</span>
          </nav>
        </div>
      </footer>
    </main>
  );
}
