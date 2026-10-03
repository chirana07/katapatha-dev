import { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { space } from "@katapatha/tokens/tokens";
import { Banner } from "@/ui/Banner";
import { BottomBar, DangerButton, LinkButton, PrimaryButton, SecondaryButton } from "@/ui/Button";
import { Card, Heading } from "@/ui/Card";
import { ChoiceRow } from "@/ui/ChoiceRow";
import { StepHeader } from "@/ui/Header";
import { Screen } from "@/ui/Screen";
import { useTheme } from "@/ui/theme";
import { useRun, useRunActions, useStop } from "@/state/useStore";
import { useConnectivity } from "@/state/connectivity";
import { isTerminal } from "@/driver/stop-state";
import { reasonOptions } from "@/driver/reason-presentation";
import {
  alreadyClosedNote,
  consequenceLines,
  otherOutcome,
  PROBLEM_BADGE,
  PROBLEM_PRIMARY_LABEL,
  PROBLEM_QUESTION,
  reasonRequiredNote,
  type ProblemOutcome,
} from "@/driver/problem-wording";
import { arrivalInfoLine, statusBadge, stopSubline } from "@/driver/stop-detail";
import { problemIntent } from "@/outbox/intents";
import { problemSendNote } from "@/outbox/claims";
import { StopNotFound } from "./stop/StopNotFound";
import { goBack, goToTrip } from "./stop/nav";

/**
 * Failed delivery (R-11), and where "Report issue" lands.
 *
 * What stopped the delivery is a pick-one list from the server's vocabulary,
 * cached at bootstrap (`snapshot.problemReasons`). When the device has never
 * managed to fetch it the local fallback is used AND the screen says so, the same
 * honesty the web console shows with a banner.
 *
 * Nothing is preselected: this closes the stop, and a destructive action must not
 * be one tap from a default the driver never chose. The button stays disabled,
 * with the reason one line above it, until a reason is picked.
 *
 * "Skip this stop instead" switches the same screen to SKIPPED (a stop passed
 * over without trying, a distinct status from FAILED); the button below is still
 * the only thing that records it.
 *
 * After recording, the driver returns to the Trip, where the stop shows as closed
 * with its "Saved on phone" status until the server has the record. No confirmation
 * is shown here: the Trip's own state is the durable one (docs/DESIGN.md).
 */
export function ProblemScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const stop = useStop(stopId);
  const { snapshot } = useRun();
  const { store, drain } = useRunActions();
  const { label: connection } = useConnectivity();
  const { c, tones } = useTheme();

  const options = useMemo(() => reasonOptions(snapshot.problemReasons), [snapshot.problemReasons]);

  const [reason, setReason] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ProblemOutcome>("FAILED");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The recorded stop turns FAILED the instant submit() returns; this keeps the
  // form on screen (not the "already closed" note) until the Trip replaces it.
  const [leaving, setLeaving] = useState(false);
  // State is async: two taps in one frame would both see busy === false and mint
  // two events for one report.
  const submitting = useRef(false);

  if (!stop) {
    return <StopNotFound detail="Go back to the trip and try again." />;
  }

  const status = stop.projection.status;
  const closed = isTerminal(status) && !leaving;
  const chosen = options.some((option) => option.code === reason) ? reason : null;
  const other = otherOutcome(outcome);
  const badge =
    outcome === "FAILED" || closed ? PROBLEM_BADGE.FAILED : PROBLEM_BADGE[outcome];

  const header = (
    <StepHeader
      stopNumber={stop.seq}
      outletId={stop.outletId}
      subline={stopSubline(stop)}
      step={closed ? statusBadge(status, false) : badge}
      onBack={goBack}
      infoLine={arrivalInfoLine({
        arrivedAt: stop.record.arrivedAt,
        windowOpen: stop.windowOpen,
        windowClose: stop.windowClose,
      }) ?? undefined}
    />
  );

  if (closed) {
    return (
      <Screen
        header={header}
        footer={
          <BottomBar primary={<PrimaryButton label="Back" onPress={goBack} />} split="back" />
        }
      >
        <Banner tone="info" title="Nothing to record" body={alreadyClosedNote(status)} />
      </Screen>
    );
  }

  const submit = async () => {
    if (submitting.current || !chosen) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await store.submit(
        problemIntent({
          stopId: stop.id,
          occurredAt: new Date().toISOString(),
          reasonCode: chosen,
          type: outcome,
        }),
      );
    } catch {
      // The write is one transaction: when it throws, nothing was stored.
      setError("This phone could not store the record, so nothing was recorded. Try again.");
      submitting.current = false;
      setBusy(false);
      return;
    }
    // Send now if there is signal. With none this does nothing visible; the record
    // is already in the outbox. Never awaited: the driver does not wait on the network.
    void drain();
    setLeaving(true);
    goToTrip();
  };

  const nextLines = [...consequenceLines(outcome), problemSendNote(connection !== "Offline")];

  return (
    <Screen
      header={header}
      footer={
        <BottomBar
          split="back"
          note={
            chosen ? undefined : (
              <Text style={{ fontSize: 14, color: c.muted, textAlign: "center" }}>
                {reasonRequiredNote(outcome)}
              </Text>
            )
          }
          secondary={<SecondaryButton label="Back" onPress={goBack} disabled={busy} />}
          primary={
            <DangerButton
              label={PROBLEM_PRIMARY_LABEL[outcome]}
              busyLabel="Saving…"
              busy={busy}
              disabled={!chosen}
              onPress={() => void submit()}
            />
          }
        />
      }
    >
      {snapshot.reasonsAreFallback ? (
        <Banner
          compact
          tone="info"
          body="The depot's reason list is not on this phone yet, so these are local defaults. They will be replaced next time the trip loads."
        />
      ) : null}

      <Heading>{PROBLEM_QUESTION[outcome]}</Heading>

      <View accessibilityRole="radiogroup" style={{ gap: space.xs + 2 }}>
        {options.map((option) => (
          <ChoiceRow
            key={option.code}
            label={option.label}
            selected={chosen === option.code}
            onPress={() => setReason(option.code)}
            disabled={busy}
          />
        ))}
      </View>

      <Card tone="info">
        <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: "700", color: tones.info.ink }}>
          What happens next
        </Text>
        {nextLines.map((line) => (
          <Text key={line} style={{ fontSize: 15, lineHeight: 22, color: tones.info.ink }}>
            {line}
          </Text>
        ))}
      </Card>

      <View style={{ gap: space.xs / 2, alignItems: "center" }}>
        <Text style={{ fontSize: 14, color: c.muted, textAlign: "center" }}>{other.explanation}</Text>
        <LinkButton
          label={other.label}
          disabled={busy}
          onPress={() => setOutcome(outcome === "FAILED" ? "SKIPPED" : "FAILED")}
        />
      </View>

      {error ? <Banner compact tone="bad" body={error} /> : null}
    </Screen>
  );
}
