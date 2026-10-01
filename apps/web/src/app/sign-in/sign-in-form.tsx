"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

const INITIAL_STATE: SignInState = {};

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signIn, INITIAL_STATE);

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <input type="hidden" name="next" value={next} />

      <label className="block" htmlFor="email">
        <span className="font-semibold">Work email</span>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
          className="mt-2 min-h-12 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-base outline-none placeholder:text-slate-400 focus:border-link focus:ring-2 focus:ring-blue-100"
          placeholder="name@company.lk"
        />
      </label>

      <label className="block" htmlFor="password">
        <span className="font-semibold">Password</span>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-2 min-h-12 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-base outline-none focus:border-link focus:ring-2 focus:ring-blue-100"
        />
      </label>

      {state.error ? (
        <div role="alert" aria-live="polite" className="rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-4 text-sm text-critical">
          <p className="font-semibold">Could not sign in</p>
          <p className="mt-1">{state.error}</p>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="flex min-h-12 w-full items-center justify-center rounded-[var(--radius-control)] bg-action px-5 font-semibold text-ink transition-[filter] hover:brightness-95 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
