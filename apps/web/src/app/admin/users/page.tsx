import type { Metadata } from "next";
import Link from "next/link";
import { Button, ButtonLink } from "@/components/ui/button";
import { DataTable, RowCard, Td, Th, Tr } from "@/components/ui/data-table";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorPanel } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { readFailure } from "@/lib/failures";
import { agoFrom, plural } from "@/lib/format";
import { DisableDialog, ReenableButton, UserDialog, type OutletOption } from "./user-dialogs";
import { ROLES, ROLE_LABELS, type Role } from "./user-form";
import { USERS_PATH, filterUsers, parseFilters, roleCounts, scopeText, usersHref, type AdminUser, type UserFilters } from "./user-view";

export const metadata: Metadata = { title: "Users · Katapatha" };
export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

const TAB_LABELS: Record<Role, string> = {
  DISPATCHER: "Dispatchers",
  LOADER: "Loaders",
  DRIVER: "Drivers",
  STORE_MANAGER: "Store managers",
  ADMIN: "Admins",
};

/**
 * Every account, as the admin manages it: the disabled ones stay listed
 * because the decision log names them, and re-enabling is one tap.
 *
 * Filters, and the add / edit / disable dialogs, are search params, so a view
 * is a link and the page stays a server component; only the dialogs' forms
 * are client code. The accounts are read once and filtered here, which keeps
 * the tab counts honest without a request per tab. The depots and outlets are
 * read alongside: the dialogs choose from them and the Scope column names
 * outlets by them.
 */
export default async function UsersPage({ searchParams }: { searchParams: Promise<Query> }) {
  const me = await requireRole("ADMIN", USERS_PATH);
  const query = await searchParams;
  const filters = parseFilters(query);
  const editId = first(query.edit);
  const disableId = first(query.disable);
  const adding = first(query.add) === "1";

  const client = await api();
  const [result, directory, outletList] = await Promise.all([
    client.GET("/admin/users").catch(() => null),
    client.GET("/admin/directory").catch(() => null),
    client.GET("/admin/outlets").catch(() => null),
  ]);

  const header = (
    <PageHeader
      title="Users"
      subtitle="Who can sign in, what they do, and which depot or outlet they work for."
      action={
        <ButtonLink href={usersHref(filters, { add: true })} variant="primary">
          Add user
        </ButtonLink>
      }
    />
  );

  if (!result?.data) {
    const failure = readFailure(result?.response.status ?? 0, "the accounts");
    return (
      <PageBody>
        {header}
        <ErrorPanel
          title={failure.title}
          detail={failure.detail}
          outcome="read"
          action={
            <ButtonLink href={USERS_PATH} variant="secondary">
              Try again
            </ButtonLink>
          }
        />
      </PageBody>
    );
  }

  const users = result.data;
  const outlets = outletList?.data ?? [];
  const depots = directory?.data?.depots ?? [];
  // Without these the dialogs could not offer a depot or outlet, so they are
  // held back with a reason rather than opened half-working.
  const optionsFailure = directory?.data && outletList?.data ? null : readFailure((directory?.data ? outletList : directory)?.response.status ?? 0, "the depots and outlets");
  const outletsById = new Map(outlets.map((outlet) => [outlet.id, outlet]));
  const outletOptions: OutletOption[] = outlets.map((outlet) => ({
    id: outlet.id,
    label: `${outlet.id} · ${outlet.displayName ?? outlet.brand} (${outlet.depotCode})`,
  }));

  const rows = filterUsers(users, filters);
  const counts = roleCounts(users, filters);
  const active = users.filter((user) => user.active).length;
  const filtering = filters.role !== null || filters.status !== "all" || filters.q !== "";
  const returnTo = usersHref(filters);
  const editing = editId ? users.find((user) => user.id === editId) : undefined;
  // Never offered for your own account: the API refuses it, and it would lock you out.
  const disabling = disableId ? users.find((user) => user.id === disableId && user.active && user.id !== me.id) : undefined;
  const wantsForm = adding || editing !== undefined;

  return (
    <PageBody>
      {header}

      {wantsForm && optionsFailure ? (
        <ErrorPanel
          title={optionsFailure.title}
          detail={`${optionsFailure.detail} An account can't be added or edited without them.`}
          outcome="read"
          action={
            <ButtonLink href={returnTo} variant="secondary">
              Close
            </ButtonLink>
          }
        />
      ) : null}

      <section aria-label="Accounts" className="flex flex-col gap-4">
        <Tabs
          label="Role"
          items={[
            { label: "All", href: usersHref({ ...filters, role: null }), current: filters.role === null, count: counts.all },
            ...ROLES.map((role) => ({
              label: TAB_LABELS[role],
              href: usersHref({ ...filters, role }),
              current: filters.role === role,
              count: counts[role],
            })),
          ]}
        />

        <form method="get" action={USERS_PATH} role="search" className="flex flex-wrap items-end gap-2">
          {filters.role ? <input type="hidden" name="role" value={filters.role} /> : null}
          <label className="min-w-0 flex-1 basis-56">
            <span className="sr-only">Search by name or email</span>
            <input
              type="search"
              name="q"
              defaultValue={filters.q}
              maxLength={80}
              placeholder="Search by name or email…"
              className="min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Status
            <select name="status" defaultValue={filters.status} className="min-h-11 rounded-control border border-line bg-surface px-3 text-sm font-normal text-ink">
              <option value="all">Active and disabled</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <Button type="submit">Apply</Button>
          {filtering ? (
            <ButtonLink href={USERS_PATH} variant="ghost">
              Clear
            </ButtonLink>
          ) : null}
        </form>

        <UsersTable rows={rows} filters={filters} returnTo={returnTo} meId={me.id} outlets={outletsById} />

        <p className="text-xs text-muted">
          {rows.length === users.length ? `${plural(users.length, "account")} · ${active} active` : `${rows.length} of ${plural(users.length, "account")}`}
        </p>
      </section>

      {adding && !optionsFailure ? <UserDialog key="add" user={null} depots={depots} outlets={outletOptions} returnTo={returnTo} /> : null}
      {editing && !optionsFailure ? <UserDialog key={editing.id} user={editing} depots={depots} outlets={outletOptions} returnTo={returnTo} /> : null}
      {disabling ? <DisableDialog key={disabling.id} user={disabling} returnTo={returnTo} /> : null}
    </PageBody>
  );
}

type OutletNames = ReadonlyMap<string, { displayName: string | null }>;

function RowActions({ user, filters, returnTo, self }: { user: AdminUser; filters: UserFilters; returnTo: string; self: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ButtonLink href={usersHref(filters, { edit: user.id })} variant="secondary" aria-label={`Edit ${user.name}`}>
        Edit
      </ButtonLink>
      {self ? null : user.active ? (
        <ButtonLink href={usersHref(filters, { disable: user.id })} variant="ghost" aria-label={`Disable ${user.name}`}>
          Disable
        </ButtonLink>
      ) : (
        <ReenableButton user={user} returnTo={returnTo} />
      )}
    </div>
  );
}

function StatusCell({ user }: { user: AdminUser }) {
  return <StatusPill label={user.active ? "Active" : "Disabled"} tone={user.active ? "good" : "neutral"} />;
}

function LastSignIn({ user }: { user: AdminUser }) {
  return user.lastSignInAt ? (
    <time dateTime={user.lastSignInAt} title={new Date(user.lastSignInAt).toLocaleString("en-GB", { timeZone: "Asia/Colombo" })}>
      {agoFrom(user.lastSignInAt)}
    </time>
  ) : (
    <span className="text-muted">Never</span>
  );
}

function NameCell({ user, filters, self }: { user: AdminUser; filters: UserFilters; self: boolean }) {
  return (
    <div className="min-w-0">
      <Link
        href={usersHref(filters, { edit: user.id })}
        className={`font-semibold underline-offset-2 hover:underline ${user.active ? "text-link" : "text-muted"}`}
      >
        {user.name}
      </Link>
      {self ? <span className="ml-2 text-xs font-semibold text-muted">(you)</span> : null}
      <p className="truncate text-xs text-muted">{user.email}</p>
    </div>
  );
}

function UsersTable({
  rows,
  filters,
  returnTo,
  meId,
  outlets,
}: {
  rows: AdminUser[];
  filters: UserFilters;
  returnTo: string;
  meId: string;
  outlets: OutletNames;
}) {
  return (
    <DataTable
      caption="Accounts"
      empty={
        rows.length === 0 ? (
          <EmptyState
            title="No accounts match"
            detail="Clear a filter or search for someone else."
            action={
              <ButtonLink href={USERS_PATH} variant="secondary">
                Show all accounts
              </ButtonLink>
            }
          />
        ) : undefined
      }
      head={
        <tr>
          <Th>Name</Th>
          <Th>Role</Th>
          <Th>Scope</Th>
          <Th>Status</Th>
          <Th>Last signed in</Th>
          <Th>
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      }
      cards={rows.map((user) => (
        <RowCard key={user.id}>
          <div className="flex items-start justify-between gap-3">
            <NameCell user={user} filters={filters} self={user.id === meId} />
            <StatusCell user={user} />
          </div>
          <p className="mt-2 text-sm text-muted">
            {ROLE_LABELS[user.role]} · {scopeText(user, outlets)}
          </p>
          <p className="mt-1 text-sm text-muted">
            Last signed in <LastSignIn user={user} />
          </p>
          <div className="mt-3">
            <RowActions user={user} filters={filters} returnTo={returnTo} self={user.id === meId} />
          </div>
        </RowCard>
      ))}
    >
      {rows.map((user) => (
        <Tr key={user.id}>
          <Td>
            <NameCell user={user} filters={filters} self={user.id === meId} />
          </Td>
          <Td>{ROLE_LABELS[user.role]}</Td>
          <Td>{scopeText(user, outlets)}</Td>
          <Td>
            <StatusCell user={user} />
          </Td>
          <Td>
            <LastSignIn user={user} />
          </Td>
          <Td>
            <RowActions user={user} filters={filters} returnTo={returnTo} self={user.id === meId} />
          </Td>
        </Tr>
      ))}
    </DataTable>
  );
}
