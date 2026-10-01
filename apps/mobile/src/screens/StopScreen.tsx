import { useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { color, space } from "@katapatha/tokens/tokens";
import { Screen } from "@/ui/Screen";
import { Card, CardTitle, Muted, SectionHeading } from "@/ui/Card";
import { StatusDot } from "@/ui/StatusDot";
import { Numeric } from "@/ui/Numeric";
import { PrimaryButton, SecondaryButton, ThumbBar } from "@/ui/Button";
import { ErrorNote, InfoNote, SavedNote } from "@/ui/Notes";
import { useRunActions, useStop } from "@/state/useStore";
import { formatClock, formatWindow } from "@/driver/format";
import { STOP_STATUS_HINT, isTerminal, primaryAction } from "@/driver/stop-state";
import { arrivalIntent, unloadIntent } from "@/outbox/intents";
import { unsentCopy } from "@/outbox/claims";

/**
 * One stop, and the single next thing to do with it.
 *
 * The stop comes from the cache, not a request -- which is why this screen works
 * with no signal at all. The web console has to refetch the whole run to render
 * one stop, because it has nowhere to keep it.
 *
 * Exactly one dominant action, pinned in the thumb zone. Completing a delivery and
 * reporting a problem are separate routes so they never compete for that slot.
 */
export function StopScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const stop = useStop(stopId);
  const { store, drain } = useRunActions();

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!stop) {
    return (
      <Screen>
        <Card>
          <CardTitle>Stop not on this run</CardTitle>
          <Muted>
            It may belong to another vehicle, or have been removed from the plan. Pull
            down on the run to refresh.
          </Muted>
        </Card>
      </Screen>
    );
  }

  const status = stop.projection.status;
  const action = primaryAction(status);
  const closed = isTerminal(status);
  const expectedUnits = (stop.orders ?? []).reduce((sum, o) => sum + o.expectedUnits, 0);

  const record = async (kind: "arrive" | "unload") => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(null);

    const occurredAt = new Date().toISOString();
    const intent =
      kind === "arrive"
        ? arrivalIntent(stop.id, occurredAt)
        : unloadIntent(stop.id, occurredAt);

    const inserted = await store.submit(intent);
    setSaved(
      inserted === 0
        ? "Already recorded on this phone."
        : kind === "arrive"
          ? "Arrival recorded."
          : "Unload started.",
    );
    // Try to send straight away. If there is no signal this does nothing visible;
    // the record is already safe in the outbox.
    void drain();
    setBusy(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.canvas }}>
      <Screen bottomInset={closed ? space.md : 120}>
        <Card>
          <Numeric style={{ fontSize: 13, color: color.muted }}>
            Stop {stop.seq} · Trip {stop.tripNo} · {stop.wave === "PREDAWN" ? "Pre-dawn" : "Daytime"}
          </Numeric>
          <CardTitle>{stop.outletName ?? stop.outletId}</CardTitle>
          <Numeric style={{ fontSize: 14, color: color.muted }}>
            Window {formatWindow(stop.windowOpen, stop.windowClose)} · arrive{" "}
            {formatClock(stop.plannedArrivalAt)}
          </Numeric>
          <StatusDot status={status} />
          <Muted>{STOP_STATUS_HINT[status]}</Muted>
        </Card>

        {stop.projection.ahead ? (
          <InfoNote>
            This phone has recorded more than the server has accepted for this stop.
            The server&apos;s version is what counts once it catches up.
          </InfoNote>
        ) : null}

        {stop.projection.state === "conflict" ? (
          <InfoNote>
            The server flagged a conflict on this stop. Pull down on the run to reload
            before recording anything else.
          </InfoNote>
        ) : null}

        {stop.projection.state === "rejected" ? (
          <ErrorNote>
            The server would not accept one of these records. Open Unsent records to
            see what it said, and tell the depot.
          </ErrorNote>
        ) : null}

        {stop.accessNote ? (
          <Card>
            <SectionHeading>Access</SectionHeading>
            <Text style={{ color: color.ink, fontSize: 15 }}>{stop.accessNote}</Text>
          </Card>
        ) : null}

        <SectionHeading>Orders</SectionHeading>
        {(stop.orders ?? []).length === 0 ? (
          <Card>
            <Muted>No order lines recorded against this stop.</Muted>
          </Card>
        ) : (
          <Card>
            {(stop.orders ?? []).map((order) => (
              <View
                key={order.orderId}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingVertical: 6,
                }}
              >
                <Numeric style={{ fontSize: 15 }}>{order.orderRef}</Numeric>
                <Numeric style={{ fontSize: 15, color: color.muted }}>
                  {order.expectedUnits} units
                </Numeric>
              </View>
            ))}
            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: color.line,
                paddingTop: 6,
                flexDirection: "row",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ fontWeight: "700", color: color.ink }}>Expected</Text>
              <Numeric style={{ fontWeight: "700" }}>{expectedUnits} units</Numeric>
            </View>
          </Card>
        )}

        {saved ? <SavedNote>{saved}</SavedNote> : null}
        {error ? <ErrorNote>{error}</ErrorNote> : null}

        {stop.projection.unsent > 0 ? (
          <Muted>{unsentCopy(stop.projection.unsent)}</Muted>
        ) : null}

        {closed ? (
          <Card>
            <Muted>This stop is closed. The record above shows the outcome.</Muted>
          </Card>
        ) : (
          <SecondaryButton
            label="Something wrong? Report a problem"
            tone="critical"
            onPress={() => router.push(`/(driver)/stops/${stop.id}/problem`)}
          />
        )}
      </Screen>

      {closed ? null : (
        <ThumbBar>
          {action.kind === "complete" ? (
            <PrimaryButton
              label={action.label}
              onPress={() => router.push(`/(driver)/stops/${stop.id}/deliver`)}
            />
          ) : (
            <PrimaryButton
              label={action.label}
              busy={busy}
              busyLabel="Recording…"
              onPress={() =>
                void record(action.kind === "arrive" ? "arrive" : "unload")
              }
            />
          )}
        </ThumbBar>
      )}
    </View>
  );
}
