import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { RoleGlyph } from "@/components/ui/role-glyph";
import { SignInForm } from "./sign-in-form";
import { parseSignInRole, ROLE_COPY, ROLE_ORDER } from "./roles";

export const metadata: Metadata = {
  title: "Sign in · Katapatha",
  description: "Sign in to your Katapatha workspace.",
};

/**
 * One page, four faces. `?role=loader` themes the copy (L-01), `?role=driver`
 * the phone layout (R-01) and so on; with no role it is the plain sign-in the
 * landing page's "Sign in" button leads to. Credentials are never printed here:
 * the demo accounts live on /access, which is closed in production.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; role?: string | string[] }>;
}) {
  const query = await searchParams;
  const next = typeof query.next === "string" ? query.next : "";
  const role = parseSignInRole(query.role);
  const copy = role ? ROLE_COPY[role] : null;

  return (
    <main className="flex min-h-screen flex-col bg-canvas lg:grid lg:grid-cols-[1fr_1fr]">
      <aside
        className="relative flex flex-col gap-8 px-5 pb-12 pt-5 text-white sm:px-8 lg:min-h-screen lg:justify-between lg:p-12"
        style={{
          background:
            "radial-gradient(60% 55% at 85% 0%, color-mix(in srgb, var(--c-ruby) 55%, transparent), transparent), radial-gradient(45% 40% at 0% 100%, color-mix(in srgb, var(--c-ochre) 22%, transparent), transparent), var(--c-navy)",
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/#roles"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-white/90 hover:text-white"
          >
            <span aria-hidden="true">←</span> All roles
          </Link>
          <Image
            src="/logo/katapatha-lockup-dark.png"
            alt="Katapatha"
            width={1600}
            height={409}
            priority
            className="h-auto w-28 lg:hidden"
          />
        </div>

        <div className="max-w-xl">
          {copy ? (
            <span className="grid size-12 place-items-center rounded-card border border-white/15 bg-white/10 text-action lg:size-14">
              <RoleGlyph kind={copy.glyph} className="h-6 w-6" />
            </span>
          ) : null}
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.2em] text-action">
            {copy ? copy.eyebrow : "Katapatha / Operations"}
          </p>
          <p className="mt-3 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            {copy ? copy.headline : "One shared truth for every delivery."}
          </p>
          <p className="mt-4 max-w-md text-base text-white/75 lg:mt-6 lg:text-lg">
            {copy ? copy.lead : "Sign in to the workspace assigned to your role."}
          </p>
          {copy ? (
            <ul className="mt-8 hidden flex-col gap-3 lg:flex">
              {copy.points.map((point) => (
                <li key={point} className="flex items-center gap-3 text-base text-white/90">
                  <span aria-hidden="true" className="text-action">✓</span>
                  {point}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <p className="hidden text-sm text-white/60 lg:block">Katapatha by Waypoint Group</p>
      </aside>

      <section className="relative -mt-6 flex flex-1 flex-col rounded-t-3xl bg-canvas px-5 pb-10 pt-8 sm:px-8 lg:mt-0 lg:items-center lg:justify-center lg:rounded-none lg:px-12">
        <div className="w-full max-w-md">
          <Image
            src="/logo/katapatha-lockup-light.png"
            alt=""
            width={1600}
            height={417}
            className="hidden h-auto w-40 lg:block"
          />

          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted lg:mt-8">
            {copy ? copy.context : "Operations access"}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
            {copy ? copy.heading : "Sign in to Katapatha"}
          </h1>
          <p className="mt-2 text-base text-muted">Enter your work email and password to continue.</p>

          <SignInForm next={next} submitLabel={copy ? copy.submit : "Sign in"} />

          {role === "driver" ? (
            <p className="mt-5 rounded-card bg-raised px-4 py-3 text-sm text-muted">
              This web page records deliveries only while it is connected. The Katapatha driver app keeps records on
              the phone when the signal drops.
            </p>
          ) : null}

          {!copy ? (
            <nav aria-label="Sign in as a specific role" className="mt-6 border-t border-line pt-5">
              <p className="text-sm text-muted">Signing in for a particular job?</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {ROLE_ORDER.map((slug) => (
                  <li key={slug}>
                    <Link
                      href={`/sign-in?role=${slug}${next ? `&next=${encodeURIComponent(next)}` : ""}`}
                      className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-raised"
                    >
                      <RoleGlyph kind={ROLE_COPY[slug].glyph} className="h-4 w-4" />
                      {ROLE_COPY[slug].heading.replace("Sign in to ", "")}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          <p className="mt-6 border-t border-line pt-5 text-sm text-muted">
            Contact your operations administrator if you cannot sign in.
          </p>
        </div>
      </section>
    </main>
  );
}
