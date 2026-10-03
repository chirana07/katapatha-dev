import type { ExceptionRow } from "./model";

/**
 * The tile at the left of an exception row. Drawn from the kind, because the
 * kind is what the dispatcher scans for ("is that a chiller or a shortfall?"),
 * and tinted by severity so the tile agrees with the pill beside it. Icons are
 * decorative: the title and pills carry the meaning.
 */
const PATHS: Record<ExceptionRow["kind"], React.ReactNode> = {
  SHORTFALL: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </>
  ),
  CHILLER: (
    <>
      <path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0Z" />
      <path d="M12 9v7" />
    </>
  ),
  PLANNING: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4h6v3H9zM12 11v4M12 18v.01" />
    </>
  ),
  LATE: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  LAMP: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" />
    </>
  ),
  PROBLEM: (
    <>
      <path d="M4 10l2-5h12l2 5" />
      <path d="M5 10v9h14v-9M9 19v-5h6v5" />
    </>
  ),
};

const TINT = {
  critical: "bg-bad-surface text-bad-ink",
  warning: "bg-warn-surface text-warn-ink",
  info: "bg-info-surface text-info-ink",
} as const;

export function KindIcon({ kind, severity }: { kind: ExceptionRow["kind"]; severity: ExceptionRow["severity"] }) {
  return (
    <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-control ${TINT[severity]}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-5">
        {PATHS[kind]}
      </svg>
    </span>
  );
}
