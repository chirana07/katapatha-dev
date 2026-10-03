import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { space } from "@katapatha/tokens/tokens";
import { Banner } from "@/ui/Banner";
import { PrimaryButton, SecondaryButton, ThumbBar } from "@/ui/Button";
import { Card, CardTitle, Muted, SectionHeading } from "@/ui/Card";
import { StepHeader } from "@/ui/Header";
import { useInsets } from "@/ui/insets";
import { Numeric } from "@/ui/Numeric";
import { Screen } from "@/ui/Screen";
import { Pill } from "@/ui/Pill";
import { useTheme } from "@/ui/theme";
import { useRun, useRunActions, useStop } from "@/state/useStore";
import { formatClock, formatWindow } from "@/driver/format";
import { startDelivery } from "@/driver/start-delivery";
import { isTerminal, STOP_STATUS_LABEL, STOP_STATUS_TONE } from "@/driver/stop-state";
import { toneForStatus } from "@/ui/tokens";
import {
  closedSummary,
  recordedFactRows,
  statusBadge,
  STOP_HINT,
  stopNotices,
  stopPrimary,
  stopSubline,
} from "@/driver/stop-detail";
import { unsentCopy } from "@/outbox/claims";
import { OrdersCard } from "./stop/OrdersCard";
import { RecordCard } from "./stop/RecordCard";
import { StopNotFound } from "./stop/StopNotFound";
import { goBack } from "./stop/nav";

/** The pinned bar: a 52px button, 16px padding above and below, and the bottom inset. */
const THUMB_BAR_HEIGHT = 52 + space.sm * 2;

/**
 * One stop, and the single next thing to do with it.
 *
 * The stop comes from the cache, not a request, which is why this screen works
 * with no signal at all. Exactly one dominant action, pinned in the thumb zone:
 * "Start delivery" (records the arrival and the start of unloading together, then
 * opens Check items) or "Continue delivery" on a stop already under way. Reporting
 * a problem is a separate, quieter button in the page, so the two never compete.
 */
export function StopScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const stop = useStop(stopId);
  const { progress } = useRun();
  const { store, drain } = useRunActions();
  const { c } = useTheme();
  const { bottom } = useInsets();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State is async: two taps in one frame would both see busy === false.
  const starting = useRef(false);

  if (!stop) {
    return (
      <StopNotFound detail="It may belong to another vehicle, or have been removed from the plan. Go back to the trip and pull down to refresh." />
    );
  }

  const { status } = stop.projection;
  const closed = isTerminal(status);
  const primary = stopPrimary(status);
  const expectedUnits = stop.orders.reduce((sum, order) => sum + order.expectedUnits, 0);

  const facts = recordedFactRows(stop.record);
  const summary = closed
    ? closedSummary({
        status,
        record: stop.record,
        expectedUnits,
        projection: stop.projection,
      })
    : null;
  const recordRows = [...facts, ...(summary?.rows ?? [])];
  const notices = stopNotices(stop.projection);
  const planned = formatClock(stop.plannedArrivalAt);

  const proceed = async () => {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setError(null);
    try {
      await startDelivery({ store, drain, stopId: stop.id, status });
    } catch {
      setError("This phone could not store the record, so nothing was recorded. Try again.");
      starting.current = false;
      setBusy(false);
      return;
    }
    router.push(`/(driver)/stops/${stop.id}/deliver`);
    starting.current = false;
    setBusy(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas }}>
      <Screen
        bottomInset={closed ? space.md : THUMB_BAR_HEIGHT + bottom + space.md}
        header={
          <StepHeader
            stopNumber={stop.seq}
            outletId={stop.outletId}
            subline={stopSubline(stop)}
            step={statusBadge(status, progress.nextStopId === stop.id)}
            onBack={goBack}
          />
        }
      >
        <Card>
          <Numeric style={{ fontSize: 13, color: c.muted }}>
            Trip {stop.tripNo} · {stop.wave === "PREDAWN" ? "Pre-dawn" : "Daytime"}
          </Numeric>
          <CardTitle>{stop.outletName ?? stop.outletId}</CardTitle>
          <Numeric style={{ fontSize: 14, color: c.muted }}>
            Window {formatWindow(stop.windowOpen, stop.windowClose)}
            {planned !== "—" ? ` · planned ${planned}` : ""}
          </Numeric>
          <Pill label={STOP_STATUS_LABEL[status]} tone={toneForStatus(STOP_STATUS_TONE[status])} />
          <Muted>{STOP_HINT[status]}</Muted>
          {stop.projection.unsent > 0 ? <Muted>{unsentCopy(stop.projection.unsent)}</Muted> : null}
        </Card>

        {notices.map((notice) => (
          <Banner key={notice.id} compact tone={notice.tone} body={notice.text} />
        ))}

        {recordRows.length > 0 || summary ? (
          <>
            <SectionHeading>{closed ? "Record" : "Recorded so far"}</SectionHeading>
            <RecordCard rows={recordRows} status={summary?.status} />
          </>
        ) : null}

        {stop.accessNote ? (
          <Card>
            <SectionHeading>Access</SectionHeading>
            <Text style={{ color: c.ink, fontSize: 15 }}>{stop.accessNote}</Text>
          </Card>
        ) : null}

        <SectionHeading>Orders</SectionHeading>
        <OrdersCard orders={stop.orders} />

        {error ? <Banner compact tone="bad" body={error} /> : null}

        {closed ? null : (
          <SecondaryButton
            label="Report issue"
            tone="critical"
            icon="warning"
            onPress={() => router.push(`/(driver)/stops/${stop.id}/problem`)}
          />
        )}
      </Screen>

      {primary ? (
        <ThumbBar>
          <PrimaryButton
            label={primary.label}
            busy={busy}
            busyLabel="Recording…"
            onPress={() => void proceed()}
          />
        </ThumbBar>
      ) : null}
    </View>
  );
}
