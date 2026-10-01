import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { color, space } from "@katapatha/tokens/tokens";
import { Screen } from "@/ui/Screen";
import { Card, CardTitle, Muted, SectionHeading } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { Numeric } from "@/ui/Numeric";
import { PrimaryButton, SecondaryButton } from "@/ui/Button";
import { InfoNote, SavedNote } from "@/ui/Notes";
import { useRun, useRunActions } from "@/state/useStore";
import { useConnectivity } from "@/state/connectivity";
import { useSession } from "@/state/session";
import { isMockBaseUrl, resolveBaseUrl, setBaseUrlOverride } from "@/api/client";
import { deviceId } from "@/platform/device";
import { formatDeviceClock } from "@/driver/format";

/**
 * Diagnostics and sign out.
 *
 * The base URL is editable on the handset because it has to be: during a demo the
 * app moves between the Prism mock and the real API, and `localhost` on a phone
 * means the phone -- so a LAN address is needed and a rebuild is not an option
 * with a device in someone's hand.
 *
 * Signing out deliberately leaves queued records alone, and says so. They are the
 * driver's record of work done, not session state.
 */
export function ConnectionScreen() {
  const { label, check } = useConnectivity();
  const { snapshot } = useRun();
  const { sql, bootstrap } = useRunActions();
  const { user, signOut } = useSession();

  const [baseUrl, setBaseUrl] = useState("");
  const [current, setCurrent] = useState("");
  const [device, setDevice] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    setSaved(`Now using ${resolved}.`);
  };

  return (
    <Screen>
      <Card>
        <CardTitle>Connection</CardTitle>
        <Muted>
          Checked against Katapatha&apos;s own health endpoint, not just whether this
          phone has a signal.
        </Muted>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor:
                label === "Connected" ? "#157347" : label === "Offline" ? color.ochre : color.muted,
            }}
          />
          <Text style={{ fontSize: 16, fontWeight: "700", color: color.ink }}>{label}</Text>
        </View>
        <SecondaryButton label="Check again" onPress={() => void check()} />
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
        <Numeric style={{ fontSize: 13, color: color.muted }}>
          Currently {current}
        </Numeric>
        {isMockBaseUrl(current) ? (
          <InfoNote>
            This is the Prism mock. It returns example data, so nothing recorded here
            reaches a real depot.
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
        <Numeric style={{ fontSize: 14, color: color.muted }}>Device {device}</Numeric>
        {snapshot.lastDrainAt ? (
          <Muted>Last sent {formatDeviceClock(snapshot.lastDrainAt)}.</Muted>
        ) : (
          <Muted>Nothing has been sent from this phone yet.</Muted>
        )}
        {snapshot.clockSkewMs !== null ? (
          <Numeric style={{ fontSize: 14, color: color.muted }}>
            Clock differs from the server by{" "}
            {Math.round(Math.abs(snapshot.clockSkewMs) / 1000)}s
          </Numeric>
        ) : null}
      </Card>

      <Card>
        <SectionHeading>Account</SectionHeading>
        {user ? (
          <>
            <Text style={{ fontSize: 16, fontWeight: "600", color: color.ink }}>
              {user.name}
            </Text>
            <Muted>{user.email}</Muted>
          </>
        ) : (
          <Muted>
            Signed in, but the server could not be asked who you are. The run shown is
            the copy held on this phone.
          </Muted>
        )}
        {snapshot.outbox.unsent > 0 ? (
          <InfoNote>
            {snapshot.outbox.unsent} record
            {snapshot.outbox.unsent === 1 ? "" : "s"} still to send. Signing out keeps
            them on this phone — they go when you sign in again.
          </InfoNote>
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
