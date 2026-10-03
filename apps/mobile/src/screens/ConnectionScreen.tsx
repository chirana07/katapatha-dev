import { useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";
import { router } from "expo-router";
import { space } from "@katapatha/tokens/tokens";
import { Screen } from "@/ui/Screen";
import { Card, CardTitle, Muted, SectionHeading } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { Numeric } from "@/ui/Numeric";
import { Pill } from "@/ui/Pill";
import { PrimaryButton, SecondaryButton } from "@/ui/Button";
import { InfoNote, SavedNote } from "@/ui/Notes";
import { useTheme } from "@/ui/theme";
import { useRun, useRunActions } from "@/state/useStore";
import { useConnectivity } from "@/state/connectivity";
import { useSession } from "@/state/session";
import { isMockBaseUrl, resolveBaseUrl, setBaseUrlOverride } from "@/api/client";
import { deviceId } from "@/platform/device";
import { lampState } from "@/driver/connection-state";
import { lampBannerCopy, signOutKeepsRecordsNote } from "@/outbox/claims";
import { usePositionSharing } from "@/position/PositionProvider";
import {
  CONSENT_COPY,
  DENIED_COPY,
  POSITION_TITLE,
  UNAVAILABLE_COPY,
  UNSENT_NOTE,
  statusLine,
} from "@/position/copy";
import { useNow } from "@/position/useNow";
import { ScreenHeader } from "./trip/ScreenHeader";
import { lastSentLine } from "./trip/outboxModel";
import { clockDifferenceLine, connectionPill, serverSwitchedNote } from "./trip/connectionModel";

/**
 * Connection, position sharing, diagnostics and sign out.
 *
 * The base URL is editable on the handset because it has to be: during a demo the
 * app moves between the Prism mock and the real API, and `localhost` on a phone
 * means the phone -- so a LAN address is needed and a rebuild is not an option
 * with a device in someone's hand.
 *
 * Position sharing follows src/position/PositionProvider.tsx: the Switch is bound
 * to `enabled`/`setEnabled`, the words are CONSENT_COPY and `statusLine` (aged by
 * `useNow`), and a refusal comes back from `setEnabled` as "denied" or
 * "unavailable". It is a last-reported position with its age, never live.
 *
 * Signing out deliberately leaves queued records alone, and says so. They are the
 * driver's record of work done, not session state.
 */
export function ConnectionScreen() {
  const { label, check, offlineSince } = useConnectivity();
  const { snapshot } = useRun();
  const { sql, bootstrap } = useRunActions();
  const { user, signOut } = useSession();
  const position = usePositionSharing();
  const now = useNow();
  const { c, tones } = useTheme();

  const [baseUrl, setBaseUrl] = useState("");
  const [current, setCurrent] = useState("");
  const [device, setDevice] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [positionNote, setPositionNote] = useState<string | null>(null);
  const [positionBusy, setPositionBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const resolved = await resolveBaseUrl(sql);
      setCurrent(resolved);
      setBaseUrl(resolved);
      setDevice(await deviceId(sql));
    })();
  }, [sql]);

  const apply = async () => {
    setBusy(true);
    setSaved(null);
    const next = baseUrl.trim();
    await setBaseUrlOverride(sql, next.length === 0 ? null : next);
    const resolved = await resolveBaseUrl(sql);
    setCurrent(resolved);
    setBaseUrl(resolved);
    await check();
    await bootstrap();
    setBusy(false);
    setSaved(serverSwitchedNote(resolved));
  };

  const recheck = async () => {
    setChecking(true);
    try {
      await check();
    } finally {
      setChecking(false);
    }
  };

  const toggleSharing = async (on: boolean) => {
    setPositionBusy(true);
    setPositionNote(null);
    try {
      const result = await position.setEnabled(on);
      if (result === "denied") setPositionNote(DENIED_COPY);
      else if (result === "unavailable") setPositionNote(UNAVAILABLE_COPY);
    } finally {
      setPositionBusy(false);
    }
  };

  const pill = connectionPill(label);
  const lamp = lampState({ label, offlineSince, now });
  const sinceLine =
    lamp.kind === "offline" || lamp.kind === "lamp"
      ? lampBannerCopy({ lamp: lamp.kind === "lamp", sinceClock: lamp.sinceClock }).title
      : null;
  const skewLine = clockDifferenceLine(snapshot.clockSkewMs);

  return (
    <Screen header={<ScreenHeader title="Connection" subtitle="Server, position and account" />}>
      <Card>
        <SectionHeading>Connection</SectionHeading>
        <Muted>
          Checked against Katapatha&apos;s own health endpoint, not just whether this phone has a
          signal.
        </Muted>
        <Pill label={label} tone={pill.tone} icon={pill.icon} />
        {sinceLine ? (
          <Text style={{ fontSize: 15, color: c.ink }}>{sinceLine}</Text>
        ) : null}
        <SecondaryButton
          label="Check again"
          busyLabel="Checking…"
          busy={checking}
          icon="refresh"
          onPress={() => void recheck()}
        />
      </Card>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <CardTitle>{POSITION_TITLE}</CardTitle>
          </View>
          <Switch
            value={position.enabled}
            onValueChange={(on) => void toggleSharing(on)}
            disabled={positionBusy}
            accessibilityLabel={POSITION_TITLE}
            trackColor={{ false: c.line, true: tones.good.fg }}
            thumbColor={c.ink}
          />
        </View>
        <Muted>{CONSENT_COPY}</Muted>
        {positionNote ? <InfoNote>{positionNote}</InfoNote> : null}
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 15, color: c.ink }}>
          {statusLine({
            status: position.status,
            detail: position.detail,
            lastReportedAt: position.lastReportedAt,
            pendingCount: position.pendingCount,
            now,
          })}
        </Text>
        {position.enabled && position.pendingCount > 0 ? <Muted>{UNSENT_NOTE}</Muted> : null}
      </Card>

      <Card>
        <SectionHeading>Server</SectionHeading>
        <Field
          label="API base URL"
          value={baseUrl}
          onChangeText={setBaseUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          editable={!busy}
          hint="Leave empty to go back to the address this build was made with."
        />
        <Numeric style={{ fontSize: 13, color: c.muted }}>Currently {current}</Numeric>
        {isMockBaseUrl(current) ? (
          <InfoNote>
            This is the Prism mock. It returns example data, so nothing recorded here reaches a real
            depot.
          </InfoNote>
        ) : null}
        <PrimaryButton
          label="Use this server"
          busyLabel="Switching…"
          busy={busy}
          onPress={() => void apply()}
        />
        {saved ? <SavedNote>{saved}</SavedNote> : null}
      </Card>

      <Card>
        <SectionHeading>This phone</SectionHeading>
        <Numeric style={{ fontSize: 14, color: c.muted }}>Device {device}</Numeric>
        {lastSentLine(snapshot.lastDrainAt) ? (
          <Muted>{lastSentLine(snapshot.lastDrainAt)}</Muted>
        ) : (
          <Muted>Nothing has been sent from this phone yet.</Muted>
        )}
        {skewLine ? <Numeric style={{ fontSize: 14, color: c.muted }}>{skewLine}</Numeric> : null}
      </Card>

      <Card>
        <SectionHeading>Account</SectionHeading>
        {user ? (
          <>
            <Text style={{ fontSize: 16, fontWeight: "600", color: c.ink }}>{user.name}</Text>
            <Muted>{user.email}</Muted>
          </>
        ) : (
          <Muted>
            Signed in, but the server could not be asked who you are. The run shown is the copy
            held on this phone.
          </Muted>
        )}
        {snapshot.outbox.unsent > 0 ? (
          <InfoNote>{signOutKeepsRecordsNote(snapshot.outbox.unsent)}</InfoNote>
        ) : null}
        <SecondaryButton
          label="Sign out"
          tone="critical"
          onPress={() => {
            void (async () => {
              await signOut();
              router.replace("/(auth)/sign-in");
            })();
          }}
        />
      </Card>
    </Screen>
  );
}
