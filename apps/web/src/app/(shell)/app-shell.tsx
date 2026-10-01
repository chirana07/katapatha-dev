import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { HOME_FOR_ROLE } from "@katapatha/core/domain/authPaths";
import { api } from "@/lib/api";
import { signOut } from "./sign-out";

export async function AppShell({ children }: { children: React.ReactNode }) {
  let result;
  try {
    const client = await api();
    result = await client.GET("/auth/me");
  } catch {
    return <WorkspaceUnavailable />;
  }

  if (result.response.status === 401) redirect("/sign-in?next=/dispatcher");
  if (result.error || !result.data) {
    return <WorkspaceUnavailable />;
  }

  const user = result.data;
  if (user.role !== "DISPATCHER") redirect(HOME_FOR_ROLE[user.role]);

  return (
    <div className="min-h-screen bg-canvas text-ink md:grid md:grid-cols-[212px_minmax(0,1fr)]">
      <a href="#workspace" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-3">
        Skip to workspace
      </a>

      <aside className="hidden min-h-screen bg-[color:var(--c-navy)] text-white md:flex md:flex-col md:px-4 md:py-5">
        <Link href="/dispatcher" className="flex min-h-11 items-center gap-3 px-2 font-semibold tracking-tight">
          <Image
            src="/logo/katapatha-lockup-dark.png"
            alt="Katapatha"
            width={1600}
            height={417}
            className="h-auto w-36"
          />
        </Link>

        <nav aria-label="Dispatcher" className="mt-9">
          <Link href="/dispatcher" aria-current="page" className="flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] bg-white/10 px-3 font-semibold text-white">
            <span aria-hidden className="grid size-5 grid-cols-2 gap-1">
              <span className="rounded-sm bg-action" /><span className="rounded-sm border border-white/70" />
              <span className="rounded-sm border border-white/70" /><span className="rounded-sm border border-white/70" />
            </span>
            Planning desk
          </Link>
        </nav>

        <div className="mt-auto border-t border-white/15 pt-4">
          <p className="truncate px-2 font-semibold">{user.name}</p>
          <p className="mt-1 truncate px-2 text-xs text-white/65">{user.depotCode ?? "Dispatch operations"}</p>
          <form action={signOut} className="mt-3">
            <button type="submit" className="min-h-11 w-full rounded-[var(--radius-control)] border border-white/20 px-3 text-left text-sm font-semibold text-white hover:bg-white/10">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex min-h-16 items-center justify-between gap-3 border-b border-line bg-surface px-4 md:hidden">
          <Link href="/dispatcher" className="flex items-center gap-2 font-semibold tracking-tight">
            <Image
              src="/logo/katapatha-lockup-light.png"
              alt="Katapatha"
              width={1600}
              height={409}
              className="h-auto w-32"
            />
          </Link>
          <form action={signOut}>
            <button type="submit" className="min-h-11 rounded-[var(--radius-control)] border border-line px-3 text-sm font-semibold">Sign out</button>
          </form>
        </header>
        <div id="workspace" tabIndex={-1}>{children}</div>
      </div>
    </div>
  );
}

function WorkspaceUnavailable() {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-4">
      <section className="w-full max-w-xl rounded-[var(--radius-card)] border border-red-200 bg-red-50 p-6">
        <h1 className="text-xl font-semibold text-critical">Workspace unavailable</h1>
        <p className="mt-2 text-muted">Katapatha could not verify your session. No planning data was changed.</p>
        <a href="/dispatcher" className="mt-5 inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-action px-4 font-semibold text-ink">
          Try again
        </a>
      </section>
    </main>
  );
}
