import type { RunStore } from "../state/store";
import { startDeliveryIntent } from "../outbox/intents";
import type { StopStatus } from "./stop-state";

/**
 * "Start delivery" / "Continue delivery".
 *
 * On a stop that has not been arrived at, one tap records the arrival and the
 * start of unloading together (one intent, one batch key), because the driver is
 * already at the outlet when they press it; on an arrived stop it records only
 * the unload start; on one already unloading it records nothing and the caller
 * simply opens the delivery. Both the Trip card and the Stop screen call this,
 * so the two cannot disagree about what the button writes.
 *
 * The record is safe in the outbox before this returns. The drain is started
 * afterwards and its result is deliberately not awaited: with no signal it does
 * nothing visible, and the driver must never wait on the network to begin.
 */
export async function startDelivery(input: {
  store: RunStore;
  drain: () => Promise<void>;
  stopId: string;
  status: StopStatus;
  now?: Date;
}): Promise<"recorded" | "already-started"> {
  const intent = startDeliveryIntent({
    stopId: input.stopId,
    status: input.status,
    occurredAt: (input.now ?? new Date()).toISOString(),
  });
  if (!intent) return "already-started";
  await input.store.submit(intent);
  void input.drain();
  return "recorded";
}
