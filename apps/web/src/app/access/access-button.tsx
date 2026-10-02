"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { AccessState } from "./actions";

type Props = {
  action: (previous: AccessState, formData: FormData) => Promise<AccessState>;
  email: string;
  home: string;
  initial: AccessState;
};

export function AccessButton({ action, email, home, initial }: Props) {
  const [state, formAction] = useActionState<AccessState, FormData>(action, initial);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="home" value={home} />
      <Submit home={home} />
      {state.error && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-red-200 bg-red-50 p-2 text-sm text-critical"
        >
          {state.error}
        </p>
      )}
    </form>
  );
}

function Submit({ home }: { home: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="min-h-11 rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:bg-raised disabled:text-muted"
    >
      {pending ? "Signing in…" : `Sign in and open ${home}`}
    </button>
  );
}
