import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { radius, space } from "@katapatha/tokens/tokens";
import { Banner } from "@/ui/Banner";
import { BottomBar, GhostButton, PrimaryButton, SecondaryButton } from "@/ui/Button";
import { Card, CardTitle, Heading, Muted } from "@/ui/Card";
import { HeaderMenuButton, TripChip, TripHeader } from "@/ui/Header";
import { Icon } from "@/ui/Icon";
import { MenuSheet, type MenuItem } from "@/ui/MenuSheet";
import { InfoNote } from "@/ui/Notes";
import { Pill } from "@/ui/Pill";
import { Screen } from "@/ui/Screen";
import { StopBadge, StopMarker } from "@/ui/StopBadge";
import { useTheme } from "@/ui/theme";
import { useConnectivity } from "@/state/connectivity";
import { useRun, useRunActions } from "@/state/useStore";
import type { ProjectedStop } from "@/state/store";
import { activeTripIndex, tripProgress, tripsOf } from "@/driver/trips";
import { startDelivery } from "@/driver/start-delivery";
import { backOnlineNotice, lampState, nextStopLine } from "@/driver/connection-state";
import {
  allSentFooterCopy,
  backOnlineCopy,
  lampBannerCopy,
  waitingFooterCopy,
} from "@/outbox/claims";
import { useNow } from "@/position/useNow";
import {
  attentionText,
  badgeLabel,
  clockSkewAdvisory,
  displayedTripIndex,
  finishedTripNote,
  footerModel,
  lastSentOutlet,
  nextStopOf,
  orderSummary,
  settledFacts,
  stopRowModels,
  tripChipLabel,
  tripChoices,
  tripsTodayLabel,
  tryNowResult,
  type StopRowModel,
} from "./trip/tripModel";

/**
 * Trip (R-02, R-03, R-06, R-10).
 *
 * The header, the connection banners, the Next stop card, the stop list and the
 * pinned foot. Every decision with a branch -- the badge on a row, which trip is
 * shown, what the foot says -- lives in ./trip/tripModel.ts and is tested there;
 * this file lays the answers out.
 *
 * Progress counts the driver's own recorded work, not just what the server has
 * accepted: showing 0 of 4 done to someone who has delivered three stops with no
 * signal would be useless, and arguably untrue. A stop done on the phone but not
 * yet sent says so on its own badge ("Saved on phone").
 */
export function RunScreen() {
  const { snapshot } = useRun();
  const { bootstrap, drain, store } = useRunActions();
  const { label, offlineSince } = useConnectivity();
  const now = useNow();
  const { c } = useTheme();

  const [refreshing, setRefreshing] = useState(false);
  const [menu, setMenu] = useState<null | "header" | "trips">(null);
  const [chosenTripId, setChosenTripId] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [trying, setTrying] = useState(false);
  const [tried, setTried] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await bootstrap();
    } finally {
      setRefreshing(false);
    }
  }, [bootstrap]);

  // Reconcile with the server once on mount. The cached run is already on screen,
  // so this deliberately does NOT drive the pull-to-refresh spinner: that belongs
  // to the gesture.
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const trips = useMemo(() => tripsOf(snapshot.stops), [snapshot.stops]);
  const shownIndex = displayedTripIndex(trips, chosenTripId, activeTripIndex(trips));
  const trip = trips[shownIndex] ?? null;
  const progress = trip ? tripProgress(trip) : null;

  const unsent = snapshot.outbox.unsent;
  const connected = label === "Connected";
  const lamp = lampState({ label, offlineSince, now });
  const backOnline = backOnlineNotice({
    unsent,
    lastSync: settledFacts(snapshot.lastSettledAt, snapshot.lastSettledCount),
    now,
    label,
  });
  const foot = footerModel({
    unsent,
    rejected: snapshot.outbox.rejected,
    conflicts: snapshot.outbox.conflicts,
    lastSettledAt: snapshot.lastSettledAt,
    now,
  });

  const openOutbox = () => router.push("/(driver)/outbox");
  const openVehicle = () => router.push("/(driver)/vehicle");

  const headerMenu: MenuItem[] = [
    {
      label: "Unsent records",
      detail: unsent > 0 ? String(unsent) : undefined,
      icon: "phone",
      onPress: openOutbox,
    },
    {
      label: "Connection and sign out",
      icon: "user",
      onPress: () => router.push("/(driver)/connection"),
    },
  ];

  const menus = (
    <>
      <MenuSheet
        visible={menu === "header"}
        onClose={() => setMenu(null)}
        items={headerMenu}
        title="Menu"
      />
      <MenuSheet
        visible={menu === "trips"}
        onClose={() => setMenu(null)}
        title="Choose a trip"
        items={tripChoices(trips, shownIndex).map((choice) => ({
          label: choice.label,
          detail: choice.detail,
          icon: choice.selected ? "check" : undefined,
          onPress: () => setChosenTripId(choice.tripId),
        }))}
      />
    </>
  );

  const menuButton = <HeaderMenuButton onPress={() => setMenu("header")} label="Menu" />;

  const tryNow = async () => {
    if (trying) return;
    setTrying(true);
    setTried(null);
    try {
      await drain({ immediate: true });
    } finally {
      setTried(
        tryNowResult({ after: store.getSnapshot().outbox.unsent, attemptedAt: new Date() }),
      );
      setTrying(false);
    }
  };

  const footer = (
    <View>
      {foot.attention !== null || foot.waiting !== null || foot.allSentAt !== null ? (
        <View
          style={{
            backgroundColor: c.canvas,
            paddingHorizontal: space.sm,
            paddingTop: space.xs + 4,
            gap: space.xs,
          }}
        >
          {foot.attention !== null ? (
            <Banner
              compact
              tone="bad"
              title={attentionText(foot.attention)}
              action={{ label: "Review", onPress: openOutbox }}
            />
          ) : null}
          {foot.waiting !== null ? (
            <Banner
              compact
              tone="warn"
              icon="cloud-off"
              title={waitingFooterCopy(foot.waiting)}
              body={tried ?? undefined}
              action={{
                label: trying ? "Trying…" : "Try now",
                icon: "refresh",
                disabled: trying,
                onPress: () => void tryNow(),
              }}
            />
          ) : null}
          {foot.allSentAt !== null ? (
            <Banner compact tone="good" icon="check" title={allSentFooterCopy(foot.allSentAt)} />
          ) : null}
        </View>
      ) : null}
      <BottomBar
        split="even"
        secondary={
          snapshot.vehicleId ? (
            <SecondaryButton label="Change vehicle" icon="swap" onPress={openVehicle} />
          ) : undefined
        }
        primary={
          <SecondaryButton
            label={unsent > 0 ? `Unsent records (${unsent})` : "Unsent records"}
            icon="doc"
            onPress={openOutbox}
          />
        }
      />
    </View>
  );

  if (!snapshot.vehicleId) {
    return (
      <>
        <Screen
          onRefresh={() => void refresh()}
          refreshing={refreshing}
          header={
            <TripHeader
              vehicleId="No vehicle"
              subtitle="Claim one to see today's stops"
              menu={menuButton}
            />
          }
          footer={footer}
        >
          <Card>
            <CardTitle>Claim a vehicle to start</CardTitle>
            <Muted>
              The depot allocator published today&apos;s run against a vehicle, not a person.
              Enter the vehicle id from the dock card to see your stops.
            </Muted>
            <SecondaryButton label="Claim a vehicle" icon="truck" onPress={openVehicle} />
          </Card>
        </Screen>
        {menus}
      </>
    );
  }

  if (!trip || !progress) {
    return (
      <>
        <Screen
          onRefresh={() => void refresh()}
          refreshing={refreshing}
          header={
            <TripHeader
              vehicleId={snapshot.vehicleId}
              subtitle="No trips today"
              menu={menuButton}
            />
          }
          footer={footer}
        >
          <Card>
            <CardTitle>No stops on today&apos;s run</CardTitle>
            <Muted>
              Nothing has been published for this vehicle today. Pull down to check again.
            </Muted>
          </Card>
        </Screen>
        {menus}
      </>
    );
  }

  const rows = stopRowModels(trip.stops);
  const next = nextStopOf(trip.stops);
  const skew = clockSkewAdvisory(snapshot.clockSkewMs);
  const offlineBanner =
    lamp.kind === "offline" || lamp.kind === "lamp"
      ? lampBannerCopy({ lamp: lamp.kind === "lamp", sinceClock: lamp.sinceClock })
      : null;
  const backOnlineBanner = backOnline
    ? backOnlineCopy({ atClock: backOnline.atClock, outletName: lastSentOutlet(snapshot.stops) })
    : null;

  const begin = async (stop: ProjectedStop) => {
    if (startingId) return;
    setStartingId(stop.id);
    setStartError(null);
    try {
      await startDelivery({
        store,
        drain: () => drain(),
        stopId: stop.id,
        status: stop.projection.status,
      });
      router.push(`/(driver)/stops/${stop.id}/deliver`);
    } catch {
      setStartError("This phone could not record the start of the delivery. Try again.");
    } finally {
      setStartingId(null);
    }
  };

  return (
    <>
      <Screen
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        header={
          <TripHeader
            vehicleId={snapshot.vehicleId}
            subtitle={tripsTodayLabel(trips.length)}
            tripChip={
              trips.length > 1 ? (
                <TripChip
                  label={tripChipLabel(shownIndex, trips.length)}
                  onPress={() => setMenu("trips")}
                />
              ) : undefined
            }
            menu={menuButton}
            progress={{ done: progress.done, total: progress.total }}
          />
        }
        footer={footer}
      >
        {offlineBanner ? (
          <Banner
            tone="warn"
            icon={lamp.kind === "lamp" ? "bulb" : "wifi-off"}
            title={offlineBanner.title}
            body={offlineBanner.body}
          />
        ) : null}
        {backOnlineBanner ? (
          <Banner tone="good" icon="bulb" title={backOnlineBanner.title} body={backOnlineBanner.body} />
        ) : null}
        {skew ? <InfoNote>{skew}</InfoNote> : null}
        {startError ? <Banner compact tone="bad" body={startError} /> : null}

        {next ? (
          <NextStopCard
            outletId={next.outletId}
            line={
              nextStopLine({ plannedClock: next.plannedArrivalAt, now, connected }).text
            }
          />
        ) : (
          <FinishedCard note={finishedTripNote(trips, shownIndex)} />
        )}

        <Heading>{`Today's stops (${rows.length})`}</Heading>

        {rows.map((row, index) => {
          const stop = trip.stops[index]!;
          return (
            <StopRow
              key={row.id}
              row={row}
              orders={stop.orders}
              starting={startingId === stop.id}
              locked={startingId !== null}
              onOpen={() => router.push(`/(driver)/stops/${stop.id}`)}
              onStart={() => void begin(stop)}
              onReport={() => router.push(`/(driver)/stops/${stop.id}/problem`)}
            />
          );
        })}
      </Screen>
      {menus}
    </>
  );
}

function NextStopCard({ outletId, line }: { outletId: string; line: string }) {
  const { c, tones } = useTheme();
  return (
    <Card tone="info">
      <View
        accessible
        accessibilityLabel={`Next stop ${outletId}. ${line}`}
        style={{ flexDirection: "row", alignItems: "center", gap: space.xs + 4 }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: tones.info.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="clock" size={28} color={tones.info.ink} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, color: c.muted }}>Next stop</Text>
          <Text
            style={{ fontSize: 24, fontWeight: "700", color: c.ink, fontVariant: ["tabular-nums"] }}
          >
            {outletId}
          </Text>
          <Text style={{ fontSize: 16, color: c.ink, fontVariant: ["tabular-nums"] }}>{line}</Text>
        </View>
      </View>
    </Card>
  );
}

function FinishedCard({ note }: { note: { title: string; body: string | null } }) {
  return (
    <Card tone="good">
      <CardTitle>{note.title}</CardTitle>
      {note.body ? <Muted>{note.body}</Muted> : null}
    </Card>
  );
}

function RowBadgeView({ row }: { row: StopRowModel }) {
  const { badge } = row;
  if (badge.kind === "conflict") return <Pill tone="info" icon="info" label={badge.label} />;
  if (badge.kind === "saved") return <StopBadge kind="saved" label={badge.label} />;
  if (badge.kind === "failed") return <StopBadge kind="failed" label={badge.label} />;
  return <StopBadge kind={badge.kind} />;
}

function StopRow({
  row,
  orders,
  starting,
  locked,
  onOpen,
  onStart,
  onReport,
}: {
  row: StopRowModel;
  orders: ReadonlyArray<{ orderRef: string; expectedUnits: number }>;
  starting: boolean;
  locked: boolean;
  onOpen: () => void;
  onStart: () => void;
  onReport: () => void;
}) {
  const { c, tones } = useTheme();
  const order = row.isNext ? orderSummary(orders) : null;
  const spoken = [
    `Stop ${row.number}`,
    row.title,
    row.subtitle,
    badgeLabel(row.badge),
    row.time.a11y,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: radius.cardLoose,
        borderWidth: row.isNext ? 2 : 1,
        borderColor: row.isNext ? c.flame : c.line,
        overflow: "hidden",
      }}
    >
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint="Opens this stop"
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs + 4,
          padding: space.xs + 6,
          backgroundColor: row.isNext ? tones.warn.surface : c.surface,
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <StopMarker state={row.marker} number={row.number} />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 18, fontWeight: "700", color: c.ink }}>
              {row.title}
              {row.subtitle ? (
                <Text style={{ fontSize: 15, fontWeight: "400", color: c.muted }}>{`  ${row.subtitle}`}</Text>
              ) : null}
            </Text>
            <RowBadgeView row={row} />
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Icon name="clock" size={16} color={c.ink} />
              <Text style={{ fontSize: 15, color: c.ink, fontVariant: ["tabular-nums"] }}>
                {row.time.text}
              </Text>
            </View>
            {row.place ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 }}>
                <Icon name="pin" size={16} color={c.ink} />
                <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 15, color: c.ink }}>
                  {row.place}
                </Text>
              </View>
            ) : null}
          </View>
          {row.detail ? (
            <Text style={{ fontSize: 14, color: c.muted, fontVariant: ["tabular-nums"] }}>{row.detail}</Text>
          ) : null}
        </View>
        <Icon name="chevron-right" size={20} color={c.ink} />
      </Pressable>

      {row.isNext && row.startLabel ? (
        <View style={{ padding: space.xs + 4, gap: space.xs + 4 }}>
          {order ? (
            <Pressable
              onPress={onOpen}
              accessibilityRole="button"
              accessibilityLabel={`${order.title}, ${order.detail}`}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space.xs + 4,
                minHeight: 56,
                paddingHorizontal: space.xs + 4,
                borderRadius: radius.card,
                borderWidth: 1,
                borderColor: c.line,
                backgroundColor: c.surface,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Icon name="clipboard" size={22} color={c.ink} />
              <View style={{ width: 1, alignSelf: "stretch", marginVertical: 10, backgroundColor: c.line }} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: "700", color: c.ink }}>
                  {order.title}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: 14, color: c.muted, fontVariant: ["tabular-nums"] }}>
                  {order.detail}
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color={c.ink} />
            </Pressable>
          ) : null}
          <View style={{ flexDirection: "row", gap: space.xs + 4, alignItems: "stretch" }}>
            <View style={{ flex: 1.2 }}>
              <PrimaryButton
                label={row.startLabel}
                icon="play"
                busy={starting}
                disabled={locked && !starting}
                onPress={onStart}
              />
            </View>
            <View style={{ flex: 1 }}>
              <GhostButton label="Report issue" icon="warning" disabled={locked} onPress={onReport} />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
