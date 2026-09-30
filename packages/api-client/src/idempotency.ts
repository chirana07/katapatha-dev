/**
 * Idempotency keys.
 *
 * Three write paths in this API are idempotent by contract, and the client is
 * responsible for the key: placing orders (`requestId`), recording a load check
 * (`clientRequestId`) and every StopEvent (its ULID id). Generate the key ONCE
 * per user intent and reuse it across retries — a fresh key per attempt defeats
 * the whole mechanism.
 */
export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}
