import Image from "next/image";
import Link from "next/link";
import { RoleGlyph, type RoleGlyphKind } from "@/components/ui/role-glyph";

export const metadata = {
  title: "Katapatha — one shared truth for every delivery",
  description:
    "One operational record moves with every delivery, from the dispatcher's desk to the loading dock, to the driver's phone, and into the store manager's receipt.",
};

const ROLES: {
  number: string;
  title: string;
  scope: string;
  does: string;
  slug: "dispatcher" | "loader" | "driver" | "store";
  icon: RoleGlyphKind;
}[] = [
  {
    number: "01",
    title: "Dispatcher",
    scope: "Peliyagoda planning office · desktop",
    does: "Turn confirmed orders into a plan the whole team can trust. Every allocation carries its reason.",
    slug: "dispatcher",
    icon: "dispatcher",
  },
  {
    number: "02",
    title: "Loader",
    scope: "Peliyagoda dock · shared tablet",
    does: "Load each stop in the right order and flag shortages before departure.",
    slug: "loader",
    icon: "loader",
  },
  {
    number: "03",
    title: "Driver",
    scope: "On the road · phone · night conditions",
    does: "See the next stop and record what happened at the door.",
    slug: "driver",
    icon: "driver",
  },
  {
    number: "04",
    title: "Store manager",
    scope: "Outlet · phone or counter PC",
    does: "Know when stock is coming, place tomorrow's order, and confirm receipt.",
    slug: "store",
    icon: "store",
  },
];

const TIMELINE = [
  { stage: "Plan", time: "16:30", note: "Every allocation carries its reason." },
  { stage: "Load", time: "01:32", note: "Shortages are visible before departure." },
  { stage: "Deliver", time: "07:04", note: "Actual counts stay with every stop." },
  { stage: "Confirm", time: "08:10", note: "Receipt closes the same record." },
] as const;

const LAMP_MODE = [
  { number: "01", role: "Driver", text: "The driver app records work on the phone while offline." },
  { number: "02", role: "Dispatcher", text: "Sees the last reported position, with its age." },
  { number: "03", role: "Store", text: "Plans staff around an honest arrival range." },
] as const;

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
            src="/logo/katapatha-lockup-light.png"
            alt="Katapatha"
            width={1600}
            height={417}
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

      <section className="mx-3 mt-3 sm:mx-5">
        <div className="relative overflow-hidden rounded-3xl bg-navy text-white">
        <Image
          src="/landing-hero.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-right opacity-55"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(100deg, color-mix(in srgb, var(--c-navy) 95%, transparent) 0%, color-mix(in srgb, var(--c-navy) 78%, transparent) 42%, color-mix(in srgb, var(--c-navy) 35%, transparent) 100%)",
          }}
        />
        <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:py-24">
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
            <figure className="rounded-card border border-white/10 bg-white/5 p-6 backdrop-blur">
              <figcaption className="text-xs font-semibold uppercase tracking-wide text-white/60">
                Illustration · a vehicle after a signal gap
              </figcaption>
              <div className="mt-4 rounded-control bg-white/10 p-4">
                <p className="text-sm font-semibold">Vehicle on its second trip</p>
                <p className="tabular mt-2 text-2xl font-semibold">Last reported 06:41</p>
                <p className="tabular text-sm text-white/70">22 min ago</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-control bg-white/10 p-3">
                  <p className="text-xs text-white/60">Arrival at the store</p>
                  <p className="tabular mt-1 text-lg font-semibold">07:10 to 07:40</p>
                  <p className="mt-1 text-xs text-white/60">A range, because the last report is old</p>
                </div>
                <div className="rounded-control bg-white/10 p-3">
                  <p className="text-xs text-white/60">Stops before the store</p>
                  <p className="tabular mt-1 text-lg font-semibold">2</p>
                  <p className="mt-1 text-xs text-white/60">Always known from the plan</p>
                </div>
              </div>
              <p className="mt-4 rounded-control bg-navy p-3 text-xs text-white/70">
                <span className="font-semibold text-action">Work continues through a signal gap. </span>
                Every figure here carries its age or says it is an estimate.
              </p>
            </figure>
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
              the <em>mirror</em>, reflecting every delivery as it is recorded, and{" "}
              <em>patha</em>, representing the traditional paper trail. It transforms that
              paper trail into a living digital record, connecting every update and
              handoff. Its four overlapping forms represent the Dispatcher, Loader,
              Driver, and Store Manager, united as one shared digital truth.
            </p>
          </div>
          <figure className="flex flex-col gap-3">
            <Image
              src="/landing-mosaic.png"
              alt="A visual language for a system that moves through cities, highlands, depots, and storefronts."
              width={786}
              height={442}
              className="h-auto w-full rounded-[var(--radius-card)]"
            />
            <figcaption className="text-xs text-muted">
              A visual language for a system that moves through cities, highlands,
              depots, and storefronts.
            </figcaption>
          </figure>
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
        <p className="mt-3 text-xs text-muted">Example times for one day, for illustration.</p>
      </section>

      <section id="roles" className="mx-auto w-full max-w-6xl scroll-mt-6 px-5 pb-20 sm:px-8">
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
            Sign in →
          </Link>
        </div>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((role) => (
            <li key={role.title}>
              <Link
                href={`/sign-in?role=${role.slug}`}
                className="group flex h-full flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5 transition-colors hover:border-[color:var(--c-navy)]"
              >
                <div className="flex items-start justify-between">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-action/15 text-[color:var(--c-navy)]">
                    <RoleGlyph kind={role.icon} />
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
              In Lamp Mode the driver app keeps its record on the phone, dispatch sees the
              age of the last reported position, and the store gets an honest arrival range.
            </p>
            <Link
              href="/sign-in?role=driver"
              className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] bg-[color:var(--c-navy)] px-4 text-sm font-semibold text-white hover:brightness-110"
            >
              Sign in as a driver <span aria-hidden="true">→</span>
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
            src="/logo/katapatha-lockup-dark.png"
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
