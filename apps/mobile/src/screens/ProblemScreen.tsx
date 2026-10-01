import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { color, radius, space, TOUCH_TARGET_MIN } from "@katapatha/tokens/tokens";
import { Screen } from "@/ui/Screen";
import { Card, CardTitle, Muted, SectionHeading } from "@/ui/Card";
import { PrimaryButton, ThumbBar } from "@/ui/Button";
import { ErrorNote, InfoNote } from "@/ui/Notes";
import { useRun, useRunActions, useStop } from "@/state/useStore";
import { problemIntent } from "@/outbox/intents";
import { FALLBACK_PROBLEM_REASONS, labelFor } from "@/driver/reasons";

/**
 * Report a problem.
 *
 * The reason list comes from the server's vocabulary, cached at bootstrap. When
 * the device has never managed to fetch it, the local fallback is used AND the
 * screen says so -- the same honesty the web console shows with a banner. A
 * hardcoded list silently diverging from the depot's is how a reason code nobody
 * recognises ends up on a delivery record.
 */
export function ProblemScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const stop = useStop(stopId);
  const { snapshot } = useRun();
  const { store, drain } = useRunActions();

  const reasons =
    snapshot.problemReasons.length > 0 ? snapshot.problemReasons : FALLBACK_PROBLEM_REASONS;

  const [reason, setReason] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"FAILED" | "SKIPPED">("FAILED");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!stop) {
    return (
      <Screen>
        <Card>
          <CardTitle>Stop not on this run</CardTitle>
          <Muted>Go back to the run and try again.</Muted>
        </Card>
      </Screen>
    );
  }

  const submit = async () => {
    if (busy) return;
    if (!reason) {
      setError("Choose a reason so the depot knows what happened.");
      return;
    }
    setError(null);
    setBusy(true);
    await store.submit(
      problemIntent({
        stopId: stop.id,
        occurredAt: new Date().toISOString(),
        reasonCode: reason,
        type: outcome,
      }),
    );
    void drain();
    setBusy(false);
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.canvas }}>
      <Screen bottomInset={120}>
        <Card>
          <CardTitle>{stop.outletName ?? stop.outletId}</CardTitle>
          <Muted>
            This closes the stop. Use it when the delivery could not be made at all.
          </Muted>
        </Card>

        {snapshot.reasonsAreFallback ? (
          <InfoNote>
            The depot&apos;s reason list is not on this phone yet, so these are local
            defaults. They will be replaced next time the run loads.
          </InfoNote>
        ) : null}

        <SectionHeading>Reason</SectionHeading>
        <Card>
          {reasons.map((code) => (
            <Choice
              key={code}
              label={labelFor(code)}
              selected={reason === code}
              onPress={() => setReason(code)}
              disabled={busy}
            />
          ))}
        </Card>

        <SectionHeading>Outcome</SectionHeading>
        <Card>
          <Choice
            label="Failed — could not deliver"
            selected={outcome === "FAILED"}
            onPress={() => setOutcome("FAILED")}
            disabled={busy}
          />
          <Choice
            label="Skipped — passed over, not attempted"
            selected={outcome === "SKIPPED"}
            onPress={() => setOutcome("SKIPPED")}
            disabled={busy}
          />
        </Card>

        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </Screen>

      <ThumbBar>
        <PrimaryButton
          label="Report problem"
          busyLabel="Saving…"
          busy={busy}
          onPress={() => void submit()}
        />
      </ThumbBar>
    </View>
  );
}

/** A radio row. Selection is a dot AND a weight change, never colour alone. */
function Choice({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET_MIN,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingVertical: space.xs,
        paddingHorizontal: 4,
        borderRadius: radius.control,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          borderWidth: 2,
          borderColor: selected ? color.navy : color.line,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected ? (
          <View
            style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.navy }}
          />
        ) : null}
      </View>
      <Text
        style={{
          fontSize: 16,
          color: color.ink,
          fontWeight: selected ? "700" : "400",
          flex: 1,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
