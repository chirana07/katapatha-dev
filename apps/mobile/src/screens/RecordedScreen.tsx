import { useEffect } from "react";
import { BackHandler, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { space } from "@katapatha/tokens/tokens";
import { Screen } from "@/ui/Screen";
import { Banner } from "@/ui/Banner";
import { Card, CardTitle, Divider, KeyValueRow, Muted } from "@/ui/Card";
import { BottomBar, PrimaryButton, SecondaryButton } from "@/ui/Button";
import { StepHeader } from "@/ui/Header";
import { Icon } from "@/ui/Icon";
import { Pill } from "@/ui/Pill";
import { StopMarker } from "@/ui/StopBadge";
import { useTheme } from "@/ui/theme";
import { useRun, useStop } from "@/state/useStore";
import { useConnectivity } from "@/state/connectivity";
import { nextStopCard, recordedView } from "./delivery/recorded";

/**
 * Step 3, "Confirm" (R-09): what this phone recorded for the stop, and what is
 * next. It renders from the store's snapshot, so when the drain settles the
 * status turns "Sent" here with no navigation.
 *
 * Every time on it is the DEVICE clock and says so. "Sent" is shown only when
 * nothing is waiting and the server did not refuse or decline a record.
 */
export function RecordedScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const stop = useStop(stopId);
  const { snapshot, progress } = useRun();
  const { label, offlineSince } = useConnectivity();
  const { c, tones } = useTheme();

  const toTrip = () => {
    if (router.canGoBack()) router.dismissAll();
    else router.replace("/(driver)");
  };

  // Back from here means the trip, not the form that was replaced by this screen.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      toTrip();
      return true;
    });
    return () => subscription.remove();
  }, []);

  if (!stop) {
    return (
      <Screen footer={<BottomBar primary={<PrimaryButton label="Back to trip" onPress={toTrip} />} />}>
        <Card>
          <CardTitle>Stop not on this run</CardTitle>
          <Muted>
            It may belong to another vehicle, or have been removed from the plan. Go back to the
            trip and pull down to refresh.
          </Muted>
        </Card>
      </Screen>
    );
  }

  const view = recordedView(stop, { label, offlineSince, now: new Date() });
  const next = nextStopCard(snapshot.stops, progress.nextStopId, stop.id);

  const toNext = () => {
    if (!next) return toTrip();
    if (router.canGoBack()) router.dismissAll();
    router.push(`/(driver)/stops/${next.stopId}`);
  };

  const header = (
    <StepHeader
      stopNumber={view.stopNumber}
      outletId={view.outletId}
      subline={view.subline}
      step={view.kind === "delivered" ? "done" : 1}
      tracker={view.kind === "delivered"}
      onBack={toTrip}
      backLabel="Back to trip"
    />
  );

  if (view.kind === "none") {
    return (
      <Screen
        header={header}
        footer={
          <BottomBar
            primary={
              <PrimaryButton
                label="Back to this stop"
                onPress={() => router.replace(`/(driver)/stops/${stop.id}`)}
              />
            }
            secondary={<SecondaryButton label="Trip" onPress={toTrip} />}
          />
        }
      >
        <Card>
          <CardTitle>No delivery recorded for this stop</CardTitle>
          <Muted>This phone has no completed delivery for it yet.</Muted>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen
      header={header}
      footer={
        <BottomBar
          secondary={<SecondaryButton label="Trip" onPress={toTrip} />}
          primary={
            <PrimaryButton
              label={next ? `Go to next stop · ${next.outletId}` : "Back to trip"}
              onPress={toNext}
            />
          }
        />
      }
    >
      <View style={{ alignItems: "center", gap: space.xs, paddingTop: space.sm }}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: tones.good.fg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="check" size={52} color={c.surface} strokeWidth={3} />
        </View>
        <Text
          accessibilityRole="header"
          style={{ fontSize: 28, fontWeight: "700", color: c.ink, marginTop: space.xs }}
        >
          Delivery recorded
        </Text>
        <Text style={{ fontSize: 15, color: c.muted, textAlign: "center", fontVariant: ["tabular-nums"] }}>
          {view.confirmation}
        </Text>
      </View>

      <Card flush>
        <KeyValueRow label="Units" value={view.units} />
        <Divider />
        <KeyValueRow label="Received by" value={view.receivedBy} />
        <Divider />
        <KeyValueRow label="Receipt" value={view.receipt} />
        <Divider />
        <KeyValueRow
          label="Status"
          value={<Pill label={view.status.label} tone={view.status.tone} icon={view.status.icon} />}
        />
      </Card>

      {view.attentionBanner ? (
        <Banner
          tone={view.attentionBanner.tone}
          title={view.attentionBanner.title}
          body={view.attentionBanner.body}
          action={{ label: "Unsent records", onPress: () => router.push("/(driver)/outbox") }}
        />
      ) : null}

      {view.waitingBanner ? (
        <Banner tone="warn" title={view.waitingBanner.title} body={view.waitingBanner.body} />
      ) : null}

      {view.heldNote ? <Banner compact tone="info" body={view.heldNote} /> : null}

      {next ? (
        <Card style={{ flexDirection: "row", alignItems: "center", gap: space.xs + 4 }}>
          <StopMarker state="current" number={next.number} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: c.ink, fontVariant: ["tabular-nums"] }}>
              {`Next · ${next.outletId}`}
            </Text>
            <Text style={{ fontSize: 14, color: c.muted, fontVariant: ["tabular-nums"] }}>{next.detail}</Text>
          </View>
        </Card>
      ) : (
        <Card tone="good" style={{ flexDirection: "row", alignItems: "center", gap: space.xs + 4 }}>
          <Icon name="check" size={28} color={tones.good.fg} strokeWidth={2.6} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: c.ink }}>Trip complete</Text>
            <Text style={{ fontSize: 14, color: c.muted }}>
              Every stop is closed. Go back to the trip to review the day.
            </Text>
          </View>
        </Card>
      )}
    </Screen>
  );
}
