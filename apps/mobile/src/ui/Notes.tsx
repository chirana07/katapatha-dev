import { Banner } from "./Banner";

/**
 * Inline messages: thin wrappers over Banner (compact), kept so the screens that
 * already import them keep working. New code uses `Banner` directly, which has
 * the icon, title and action.
 *
 * The role split is copied from the web console: an error is an `alert`, but an
 * expired session or a saved confirmation is a `status`.
 */

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return <Banner compact tone="bad" body={children} />;
}

export function SavedNote({ children }: { children: React.ReactNode }) {
  return <Banner compact tone="good" body={children} />;
}

/** Advisory: true, worth saying, not a failure. */
export function InfoNote({ children }: { children: React.ReactNode }) {
  return <Banner compact tone="info" body={children} />;
}
