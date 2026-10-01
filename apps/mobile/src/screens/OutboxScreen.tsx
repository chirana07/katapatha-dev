import { useState } from "react";
import { Text, View } from "react-native";
import { color, space } from "@katapatha/tokens/tokens";
import { Screen } from "@/ui/Screen";
import { Card, CardTitle, Muted, SectionHeading } from "@/ui/Card";
import { Numeric } from "@/ui/Numeric";
import { PrimaryButton } from "@/ui/Button";
import { ErrorNote, InfoNote, SavedNote } from "@/ui/Notes";
import { useRun, useRunActions } from "@/state/useStore";
import { outboxExplainer } from "@/outbox/claims";
import { formatDeviceClock } from "@/driver/format";
import { MAX_AUTOMATIC_ATTEMPTS } from "@/outbox/backoff";

/**
 * What is waiting, and what the server said.
 *
 * This screen exists so a driver never has to trust a spinner. It shows the
 * records held on the phone, the last drain's actual counts from sync_log, and
 * -- in full -- anything the server refused, because a rejection is the one
 * outcome that loses their work and they may need to phone the depot about it.
 *
 * The explanatory line comes from src/outbox/claims.ts, so what the app promises
 * about offline durability is decided in one place.
 *
 * Everything shown is read from the store snapshot, not fetched here. One read
 * path into SQLite means this screen and the header badge cannot disagree about
 * how many records are waiting.
 */
export function OutboxScreen() {
  const { snapshot } = useRun();
  const { store, drain } = useRunActions();

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const rows = snapshot.pending;
  const log = snapshot.lastSync;

  const sendNow = async () => {
    setBusy(true);
    setNote(null);
    await drain({ immediate: true });
    setBusy(false);
    setNote("Send attempted. The counts below are what the server reported.");
  };

  const rejected = rows.filter((row) => row.state === "rejected");
  const conflicts = rows.filter((row) => row.state === "conflict");
  const waiting = rows.filter((row) => row.state === "queued" || row.state === "sending");

  return (
    <Screen onRefresh={() => void store.refresh()}>
      <Card>
        <CardTitle>
          {snapshot.outbox.unsent === 0
            ? "Everything has been sent"
            : `${snapshot.outbox.unsent} waiting to send`}
        </CardTitle>
        <Muted>{outboxExplainer()}</Muted>
        {snapshot.lastDrainAt ? (
          <Muted>Last sent {formatDeviceClock(snapshot.lastDrainAt)}.</Muted>
        ) : null}
        <PrimaryButton
          label="Send now"
          busyLabel="Sending…"
          busy={busy}
          disabled={rows.length === 0}
          onPress={() => void sendNow()}
        />
        {note ? <SavedNote>{note}</SavedNote> : null}
      </Card>

      {log ? (
        <Card>
          <SectionHeading>Last attempt</SectionHeading>
          <Numeric style={{ fontSize: 14, color: color.muted }}>
            {log.endpoint} · {log.outcome}
          </Numeric>
          {log.sent !== null ? (
            <Numeric style={{ fontSize: 14 }}>
              sent {log.sent} · accepted {log.accepted ?? 0} · already held{" "}
              {log.duplicates ?? 0} · conflicts {log.conflicts ?? 0}
            </Numeric>
          ) : null}
          {log.note ? <Muted>{log.note}</Muted> : null}
        </Card>
      ) : null}

      {rejected.length > 0 ? (
        <>
          <SectionHeading>Not accepted</SectionHeading>
          {rejected.map((row) => (
            <Card key={row.id}>
              <CardTitle>{row.type.replace("_", " ").toLowerCase()}</CardTitle>
              <Muted>{formatDeviceClock(row.occurred_at)}</Muted>
              <ErrorNote>
                {row.last_error ??
                  "The server would not accept this record and will not be asked again."}
              </ErrorNote>
              <Muted>
                Tell the depot what happened at this stop. This record will not be sent
                again.
              </Muted>
            </Card>
          ))}
        </>
      ) : null}

      {conflicts.length > 0 ? (
        <>
          <SectionHeading>Superseded by the server</SectionHeading>
          {conflicts.map((row) => (
            <Card key={row.id}>
              <CardTitle>{row.type.replace("_", " ").toLowerCase()}</CardTitle>
              <Muted>{formatDeviceClock(row.occurred_at)}</Muted>
              <InfoNote>
                {row.conflict_state === "STALE_ASSIGNMENT"
                  ? "This stop had been reassigned, so the server kept its own record. Reload the run."
                  : "A later record replaced this one on the server."}
              </InfoNote>
            </Card>
          ))}
        </>
      ) : null}

      {waiting.length > 0 ? (
        <>
          <SectionHeading>Held on this phone</SectionHeading>
          {waiting.map((row) => (
            <Card key={row.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 15, fontWeight: "600", color: color.ink }}>
                  {row.type.replace("_", " ").toLowerCase()}
                </Text>
                <Numeric style={{ fontSize: 13, color: color.muted }}>
                  {row.state === "sending" ? "sending" : "waiting"}
                </Numeric>
              </View>
              <Muted>{formatDeviceClock(row.occurred_at)}</Muted>
              {row.attempts >= MAX_AUTOMATIC_ATTEMPTS ? (
                <InfoNote>
                  Tried {row.attempts} times without success, so Katapatha has stopped
                  retrying by itself. Tap Send now when you have a good signal.
                </InfoNote>
              ) : row.last_error ? (
                <Muted>{row.last_error}</Muted>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <Muted>
            Nothing is waiting. Every record this phone made has reached Katapatha.
          </Muted>
        </Card>
      ) : null}

      <View style={{ height: space.md }} />
    </Screen>
  );
}
