import type { Metadata } from "next";
import Image from "next/image";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in · Katapatha",
  description: "Sign in to your Katapatha operations workspace.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const query = await searchParams;
  const next = typeof query.next === "string" ? query.next : "";

  return (
    <main className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(320px,0.9fr)_minmax(520px,1.1fr)]">
      <section className="flex items-center justify-center px-5 py-10 sm:px-8 lg:px-12">
        <div className="w-full max-w-md">
          <Image
            src="/logo/katapatha-lockup-light.png"
            alt="Katapatha"
            width={1600}
            height={409}
            priority
            className="h-auto w-44"
          />

          <div className="mt-10">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">Operations access</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Welcome back</h1>
            <p className="mt-3 max-w-sm text-base text-muted">
              Sign in to continue to the workspace assigned to your role.
            </p>
          </div>

          <SignInForm next={next} />
          <p className="mt-6 text-sm text-muted">
            Access is managed by your operations administrator.
          </p>
        </div>
      </section>

      <aside className="hidden bg-[color:var(--c-navy)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white/65">Waypoint Group delivery operations</p>
        <div className="max-w-xl">
          <p className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
            One clear handoff from order to delivery.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] bg-white/15">
            {[
              ["Plan", "Build dependable daily runs"],
              ["Load", "Verify every item at the dock"],
              ["Deliver", "Record progress from the road"],
              ["Receive", "Close the loop at the outlet"],
            ].map(([title, detail]) => (
              <div key={title} className="bg-[color:var(--c-navy)] p-5">
                <p className="font-semibold text-action">{title}</p>
                <p className="mt-2 text-sm text-white/70">{detail}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-sm text-white/55">Secure role-based access</p>
      </aside>
    </main>
  );
}
