import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Link, router } from "expo-router";
import { color, space } from "@katapatha/tokens/tokens";
import { Screen } from "@/ui/Screen";
import { Card, CardTitle, Muted, SectionHeading } from "@/ui/Card";
import { StatusDot } from "@/ui/StatusDot";
import { Pill } from "@/ui/Pill";
import { Numeric } from "@/ui/Numeric";
import { SecondaryButton } from "@/ui/Button";
import { InfoNote } from "@/ui/Notes";
import { useRun, useRunActions } from "@/state/useStore";
import { formatWindow, formatClock } from "@/driver/format";
import { isTerminal, primaryAction } from "@/driver/stop-state";
import { unsentCopy } from "@/outbox/claims";
import type { ProjectedStop } from "@/state/store";

/**
 * Today's run.
 *
 * Stops are flat across trips, in driving order, exactly as the web console shows
 * them -- a driver thinks in stops, not in the planner's trip boundaries, though
 * each card still says which trip it belongs to.
 *
 * Progress counts the driver's own recorded work, not just what the server has
 * accepted. Showing 0 of 6 done to someone who has delivered three stops offline
 * would be useless, and arguably untrue.
 */
export function RunScreen() {
  const { snapshot, progress } = useRun();
  const { bootstrap } = useRunActions();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await bootstrap();
    setRefreshing(false);
  }, [bootstrap]);

  // Reconcile with the server once on mount. The cached run is already on screen,
  // so this deliberately does NOT drive the pull-to-refresh spinner -- that
  // belongs to the gesture, and setting it here would also mean calling setState
  // synchronously from an effect.
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (!snapshot.vehicleId) {
    return (
      <Screen onRefresh={() => void refresh()} refreshing={refreshing}>
        <Card>
          <CardTitle>Claim a vehicle to start</CardTitle>
          <Muted>
            The depot allocator published today&apos;s run against a vehicle, not a
            person. Enter the vehicle id from the dock card to see your stops.
          </Muted>
          <SecondaryButton
            label="Claim a vehicle"
            onPress={() => router.push("/(driver)/vehicle")}
          />
        </Card>
        <FooterLinks unsent={snapshot.outbox.unsent} />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={() => void refresh()} refreshing={refreshing}>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View>
            <CardTitle>{snapshot.vehicleId}</CardTitle>
            <Muted>{snapshot.date}</Muted>
          </View>
          <Pill label={`Trip ${snapshot.stops[0]?.tripNo ?? 1}`} />
        </View>

        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
          <Numeric style={{ fontSize: 24, fontWeight: "700" }}>
            {progress.done}
          </Numeric>
          <Muted>of</Muted>
          <Numeric style={{ fontSize: 16, color: color.muted }}>
            {progress.total}
          </Numeric>
          <Muted>stops closed</Muted>
        </View>

        {snapshot.outbox.unsent > 0 ? (
          <Muted>{unsentCopy(snapshot.outbox.unsent)}</Muted>
        ) : null}
      </Card>

      {snapshot.clockSkewMs !== null && Math.abs(snapshot.clockSkewMs) > 120_000 ? (
        <InfoNote>
          This phone&apos;s clock is{" "}
          {Math.round(Math.abs(snapshot.clockSkewMs) / 60_000)} minutes{" "}
          {snapshot.clockSkewMs > 0 ? "ahead of" : "behind"} the server. Times recorded
          on device may look wrong.
        </InfoNote>
      ) : null}

      <SectionHeading>Stops</SectionHeading>

      {snapshot.stops.length === 0 ? (
        <Card>
          <CardTitle>No stops on today&apos;s run</CardTitle>
          <Muted>
            Nothing has been published for this vehicle today. Pull down to check
            again.
          </Muted>
        </Card>
      ) : (
        snapshot.stops.map((stop, index) => (
          <StopCard
            key={stop.id}
            stop={stop}
            isNext={stop.id === progress.nextStopId}
            position={index + 1}
          />
        ))
      )}

      <FooterLinks unsent={snapshot.outbox.unsent} />
    </Screen>
  );
}

function StopCard({
  stop,
  isNext,
  position,
}: {
  stop: ProjectedStop;
  isNext: boolean;
  position: number;
}) {
  const closed = isTerminal(stop.projection.status);
  const action = primaryAction(stop.projection.status);
  const units = (stop.orders ?? []).reduce((sum, order) => sum + order.expectedUnits, 0);

  return (
    <Card
      onPress={() => router.push(`/(driver)/stops/${stop.id}`)}
      accessibilityLabel={`Stop ${position}, ${stop.outletName ?? stop.outletId}`}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <Numeric style={{ fontSize: 13, color: color.muted }}>
            Stop {position} · Trip {stop.tripNo}
          </Numeric>
        </View>
        {isNext ? <Pill label="Next stop" tone="accent" /> : null}
      </View>

      <CardTitle>{stop.outletName ?? stop.outletId}</CardTitle>

      <Numeric style={{ fontSize: 14, color: color.muted }}>
        Window {formatWindow(stop.windowOpen, stop.windowClose)} · arrive{" "}
        {formatClock(stop.plannedArrivalAt)}
      </Numeric>

      {units > 0 ? (
        <Numeric style={{ fontSize: 14, color: color.muted }}>
          {units} units over {(stop.orders ?? []).length} order
          {(stop.orders ?? []).length === 1 ? "" : "s"}
        </Numeric>
      ) : null}

      <StatusDot
        status={stop.projection.status}
        suffix={
          stop.projection.state === "rejected"
            ? "not accepted"
            : stop.projection.state === "conflict"
              ? "needs a reload"
              : stop.projection.unsent > 0
                ? `${stop.projection.unsent} unsent`
                : undefined
        }
      />

      <Text style={{ color: color.link, fontSize: 15, fontWeight: "600" }}>
        {closed ? "View recorded delivery" : action.label} →
      </Text>
    </Card>
  );
}

function FooterLinks({ unsent }: { unsent: number }) {
  return (
    <View style={{ gap: space.xs, paddingTop: space.xs }}>
      <Link
        href="/(driver)/outbox"
        style={{ color: color.link, fontSize: 15, paddingVertical: space.xs }}
      >
        Unsent records{unsent > 0 ? ` (${unsent})` : ""}
      </Link>
      <Link
        href="/(driver)/connection"
        style={{ color: color.link, fontSize: 15, paddingVertical: space.xs }}
      >
        Connection and sign out
      </Link>
    </View>
  );
}
