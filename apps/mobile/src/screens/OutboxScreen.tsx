import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { space } from "@katapatha/tokens/tokens";
import { Screen } from "@/ui/Screen";
import { Card, CardTitle, Muted, SectionHeading } from "@/ui/Card";
import { Numeric } from "@/ui/Numeric";
import { PrimaryButton } from "@/ui/Button";
import { ErrorNote, InfoNote, SavedNote } from "@/ui/Notes";
import { Pill } from "@/ui/Pill";
import { useTheme } from "@/ui/theme";
import { useRun, useRunActions } from "@/state/useStore";
import { outboxExplainer, outboxHeldHeading } from "@/outbox/claims";
import { formatDeviceClock } from "@/driver/format";
import { ScreenHeader } from "./trip/ScreenHeader";
import {
  conflictSentence,
  eventLabel,
  groupOutboxRows,
  lastAttemptLines,
  lastSentLine,
  outboxTitle,
  rejectionSentence,
  sendNowResult,
  stoppedRetrying,
  waitingStateLabel,
} from "./trip/outboxModel";

/**
 * Unsent records: what is waiting, and what the server said.
 *
 * This screen exists so a driver never has to trust a spinner. It shows the
 * records held on the phone, the last drain's actual counts from sync_log, and --
 * in full -- anything the server refused, because a rejection is the one outcome
 * that does not reach the depot and they may need to phone about it. A refused
 * record is a KNOWN outcome and is worded as one; an unconfirmed record is never
 * called failed, because the phone has no answer for it.
 *
 * The explanatory line comes from src/outbox/claims.ts, so what the app promises
 * about offline durability is decided in one place.
 *
 * Everything shown is read from the store snapshot, not fetched here. One read
 * path into SQLite means this screen and the Trip screen's count cannot disagree
 * about how many records are waiting.
 */
export function OutboxScreen() {
  const { snapshot } = useRun();
  const { store, drain } = useRunActions();
  const { c } = useTheme();

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReturnType<typeof sendNowResult> | null>(null);

  const groups = useMemo(() => groupOutboxRows(snapshot.pending), [snapshot.pending]);
  const outletOf = useMemo(
    () => new Map(snapshot.stops.map((stop) => [stop.id, stop.outletId])),
    [snapshot.stops],
  );
  const sentLine = lastSentLine(snapshot.lastDrainAt);
  const log = snapshot.lastSync ? lastAttemptLines(snapshot.lastSync) : null;
  const nothing =
    groups.waiting.length + groups.rejected.length + groups.conflicts.length === 0;

  const sendNow = async () => {
    setBusy(true);
    setResult(null);
    try {
      await drain({ immediate: true });
    } finally {
      setResult(
        sendNowResult({
          remaining: store.getSnapshot().outbox.unsent,
          attemptedAt: new Date(),
        }),
      );
      setBusy(false);
    }
  };

  const heading = (type: string, stopId: string) => {
    const outlet = outletOf.get(stopId);
    return outlet ? `${outlet} · ${eventLabel(type)}` : eventLabel(type);
  };

  return (
    <Screen
      onRefresh={() => void store.refresh()}
      header={<ScreenHeader title="Unsent records" />}
    >
      <Card>
        <CardTitle>{outboxTitle(snapshot.outbox)}</CardTitle>
        <Muted>{outboxExplainer()}</Muted>
        {sentLine ? <Muted>{sentLine}</Muted> : null}
        <PrimaryButton
          label="Send now"
          icon="refresh"
          busyLabel="Sending…"
          busy={busy}
          disabled={groups.waiting.length === 0}
          onPress={() => void sendNow()}
        />
        {result ? (
          result.tone === "good" ? (
            <SavedNote>{result.text}</SavedNote>
          ) : (
            <InfoNote>{result.text}</InfoNote>
          )
        ) : null}
      </Card>

      {log ? (
        <Card>
          <SectionHeading>Last attempt</SectionHeading>
          <Numeric style={{ fontSize: 14, color: c.muted }}>{log.headline}</Numeric>
          {log.counts ? <Numeric style={{ fontSize: 14, color: c.ink }}>{log.counts}</Numeric> : null}
          {snapshot.lastSync?.note ? <Muted>{snapshot.lastSync.note}</Muted> : null}
        </Card>
      ) : null}

      {groups.rejected.length > 0 ? (
        <>
          <SectionHeading>Not accepted by the server</SectionHeading>
          {groups.rejected.map((row) => (
            <Card key={row.id}>
              <CardTitle>{heading(row.type, row.stop_id)}</CardTitle>
              <Muted>{formatDeviceClock(row.occurred_at)}</Muted>
              <ErrorNote>{rejectionSentence(row)}</ErrorNote>
              <Muted>This record will not be sent again.</Muted>
            </Card>
          ))}
        </>
      ) : null}

      {groups.conflicts.length > 0 ? (
        <>
          <SectionHeading>Replaced by the server</SectionHeading>
          {groups.conflicts.map((row) => (
            <Card key={row.id}>
              <CardTitle>{heading(row.type, row.stop_id)}</CardTitle>
              <Muted>{formatDeviceClock(row.occurred_at)}</Muted>
              <InfoNote>{conflictSentence(row)}</InfoNote>
            </Card>
          ))}
        </>
      ) : null}

      {groups.waiting.length > 0 ? (
        <>
          <SectionHeading>{outboxHeldHeading()}</SectionHeading>
          {groups.waiting.map((row) => (
            <Card key={row.id}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.xs }}>
                <Text style={{ flexShrink: 1, fontSize: 16, fontWeight: "700", color: c.ink }}>
                  {heading(row.type, row.stop_id)}
                </Text>
                <Pill tone="warn" icon="phone" label={waitingStateLabel(row.state)} />
              </View>
              <Muted>{formatDeviceClock(row.occurred_at)}</Muted>
              {stoppedRetrying(row.attempts) ? (
                <InfoNote>
                  Tried {row.attempts} times without an answer, so Katapatha has stopped trying by
                  itself. Tap Send now when you have a good signal.
                </InfoNote>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      {nothing ? (
        <Card>
          <Muted>Nothing is waiting. Every record this phone made has reached Katapatha.</Muted>
        </Card>
      ) : null}
    </Screen>
  );
}
