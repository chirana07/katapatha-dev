/**
 * The only module in this app allowed to write to the console; eslint's
 * no-console enforces that everywhere else.
 *
 * docs/CONVENTIONS.md: "never log a password, session token, signature or photo
 * payload". A driver app is the likeliest place to break that rule by accident,
 * because the objects being passed around are exactly the ones carrying those
 * fields -- a StopEvent with a signature on it is the normal case here, not an
 * edge case. So redaction lives at the sink, where it cannot be forgotten at a
 * call site.
 */

const REDACTED = "[redacted]";

/** Fields that must never reach a log, in any casing the codebase uses. */
const SECRET_KEYS = new Set([
  "password",
  "token",
  "signaturedata",
  "photodata",
  "authorization",
  "passwordhash",
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEYS.has(key.toLowerCase())
      ? REDACTED
      : redact(inner, depth + 1);
  }
  return out;
}

function emit(
  write: (message: string, context?: unknown) => void,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (context === undefined) {
    write(message);
    return;
  }
  write(message, redact(context));
}

export const log = {
  info(message: string, context?: Record<string, unknown>): void {
    emit(console.log, message, context);
  },
  warn(message: string, context?: Record<string, unknown>): void {
    emit(console.warn, message, context);
  },
  error(message: string, context?: Record<string, unknown>): void {
    emit(console.error, message, context);
  },
};

/** Exported for the test that proves a signature never survives a log call. */
export const redactForTest = redact;
