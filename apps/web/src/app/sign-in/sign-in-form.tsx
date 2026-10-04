"use client";

import { useActionState, useState } from "react";
import { signIn, type SignInState } from "./actions";

const INITIAL_STATE: SignInState = {};

const INPUT =
  "mt-2 min-h-12 w-full rounded-control border border-line bg-surface px-3 text-base text-ink outline-none placeholder:text-muted/70 focus:border-link focus:ring-2 focus:ring-link/25";

export function SignInForm({
  next,
  submitLabel,
  credential = "email",
}: {
  next: string;
  submitLabel: string;
  /** "staff": staff ID and PIN, for the loader's shared dock tablet (L-01). */
  credential?: "email" | "staff";
}) {
  const [state, formAction, pending] = useActionState(signIn, INITIAL_STATE);
  const [reveal, setReveal] = useState(false);

  return (
    <form action={formAction} className="mt-6 space-y-5">
      <input type="hidden" name="next" value={next} />

      {credential === "staff" ? (
        <>
          <label className="block" htmlFor="staffId">
            <span className="font-semibold text-ink">Staff ID</span>
            <input
              id="staffId"
              name="staffId"
              type="text"
              autoComplete="username"
              autoCapitalize="characters"
              spellCheck={false}
              required
              autoFocus
              className={INPUT}
              placeholder="Enter your staff ID"
            />
          </label>
          <label className="block" htmlFor="pin">
            <span className="font-semibold text-ink">PIN</span>
            <input
              id="pin"
              name="pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4,8}"
              autoComplete="current-password"
              required
              className={INPUT}
              placeholder="Enter your PIN"
            />
          </label>
        </>
      ) : (
      <>
      <label className="block" htmlFor="email">
        <span className="font-semibold text-ink">Work email</span>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
          className={INPUT}
          placeholder="name@company.lk"
        />
      </label>

      <div>
        <label htmlFor="password" className="font-semibold text-ink">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={reveal ? "text" : "password"}
            autoComplete="current-password"
            required
            className={`${INPUT} pr-20`}
          />
          <button
            type="button"
            onClick={() => setReveal((value) => !value)}
            aria-pressed={reveal}
            className="absolute right-1 top-3 grid min-h-11 min-w-16 place-items-center rounded-control px-2 text-sm font-semibold text-link hover:bg-raised"
          >
            {reveal ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      </>
      )}

      {state.error ? (
        <div role="alert" aria-live="polite" className="rounded-card border border-bad/25 bg-bad-surface p-4 text-sm text-ink">
          <p className="font-semibold text-bad-ink">Could not sign in</p>
          <p className="mt-1">{state.error}</p>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-control px-5 font-semibold text-white transition-[filter] hover:brightness-125 disabled:cursor-wait disabled:opacity-60 ${credential === "staff" ? "bg-night" : "bg-navy"}`}
      >
        {pending ? "Signing in…" : submitLabel}
        {pending ? null : <span aria-hidden="true">→</span>}
      </button>
    </form>
  );
}
