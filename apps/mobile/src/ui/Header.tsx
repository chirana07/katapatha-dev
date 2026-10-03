import { Image, Pressable, Text, View } from "react-native";
import { nightTone } from "@katapatha/tokens/tokens";
import { ConnectivityBadge } from "../screens/ConnectivityBadge";
import type { ConnectivityLabel } from "../state/connectivity";
import { ConnectivityChip } from "./ConnectivityChip";
import { Icon } from "./Icon";
import { useInsets } from "./insets";
import {
  DEFAULT_STEP_LABELS,
  stepBadgeLabel,
  stepTrackerState,
  type StepLabels,
  type StepValue,
  type TrackerState,
} from "./logic";
import { ProgressBar } from "./ProgressBar";
import { StatusBarOnDark } from "./StatusBarStyle";
import { useTheme } from "./theme";
import { DANGER, HEADER } from "./tokens";

/**
 * The navy rounded-bottom block at the top of every driver screen (R-02..R-11).
 * It extends under the status bar and is navy in both schemes (navy is a brand
 * hue, not a surface); night darkens the page below it and adds a hairline.
 */
function Frame({ children }: { children: React.ReactNode }) {
  const { scheme } = useTheme();
  const { top } = useInsets();
  return (
    <View
      style={{
        backgroundColor: HEADER.surface,
        paddingTop: top + 12,
        paddingHorizontal: 16,
        paddingBottom: 16,
        borderBottomLeftRadius: 28,
        borderBottomRightRadius: 28,
        borderBottomWidth: 1,
        borderBottomColor: HEADER.edge[scheme],
      }}
    >
      <StatusBarOnDark />
      {children}
    </View>
  );
}

// The white-wordmark lockup: the file name says which SURFACE it suits (docs/DESIGN.md).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOCKUP = require("../../assets/katapatha-lockup-dark.png") as number;
const LOCKUP_WIDTH = 116;

function Lockup() {
  return (
    <Image
      source={LOCKUP}
      accessibilityLabel="Katapatha"
      resizeMode="contain"
      style={{ width: LOCKUP_WIDTH, height: Math.round((LOCKUP_WIDTH * 409) / 1600) }}
    />
  );
}

/** The ⋮ button. Pair it with `MenuSheet`. */
export function HeaderMenuButton({
  onPress,
  label = "Menu",
}: {
  onPress: () => void;
  label?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? HEADER.control : "transparent",
      })}
    >
      <Icon name="dots-vertical" size={22} color={HEADER.text} />
    </Pressable>
  );
}

/** "Trip 1 of 2 ⌄": the outlined chip that opens the trip choice. */
export function TripChip({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label}. Choose a trip`}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: HEADER.outline,
        backgroundColor: pressed ? HEADER.control : "transparent",
      })}
    >
      <Icon name="swap" size={18} color={HEADER.text} />
      <Text style={{ fontSize: 16, color: HEADER.text, fontVariant: ["tabular-nums"] }}>{label}</Text>
      <Icon name="chevron-down" size={18} color={HEADER.text} />
    </Pressable>
  );
}

/**
 * The Trip header (R-02, R-03, R-06, R-10): logo, connectivity chip + wifi glyph,
 * ⋮ menu, the vehicle id with its subtitle, the trip chip, and the progress bar.
 *
 * `connectivity` is optional: omitted, the header shows the live
 * `ConnectivityBadge` (verified /health); a harness passes a label to render all
 * three states without a provider. The depot name is not in the run payload, so
 * `subtitle` is whatever true line the screen has (e.g. "2 trips today").
 */
export function TripHeader({
  vehicleId,
  subtitle,
  connectivity,
  tripChip,
  menu,
  progress,
}: {
  vehicleId: string;
  subtitle?: string;
  connectivity?: ConnectivityLabel;
  /** Usually a `TripChip`; omit when the vehicle has one trip. */
  tripChip?: React.ReactNode;
  /** Usually a `HeaderMenuButton`. */
  menu?: React.ReactNode;
  progress?: { done: number; total: number; label?: string };
}) {
  return (
    <Frame>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Lockup />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {connectivity ? <ConnectivityChip label={connectivity} /> : <ConnectivityBadge />}
          {menu}
        </View>
      </View>

      <View
        style={{
          marginTop: 10,
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <View style={{ flexShrink: 1 }}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{ fontSize: 32, fontWeight: "700", color: HEADER.text, fontVariant: ["tabular-nums"] }}
          >
            {vehicleId}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} style={{ fontSize: 16, color: HEADER.sub }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {tripChip}
      </View>

      {progress ? (
        <View style={{ marginTop: 14 }}>
          <ProgressBar done={progress.done} total={progress.total} label={progress.label} onNavy />
        </View>
      ) : null}
    </Frame>
  );
}

export type StepBadgeSpec = {
  label: string;
  tone: "good" | "warn" | "bad" | "neutral";
};

function Badge({ step }: { step: StepValue | StepBadgeSpec }) {
  const { c } = useTheme();
  let surface: string = HEADER.control;
  let ink: string = c.flame;
  let label: string;

  if (typeof step === "object") {
    label = step.label;
    switch (step.tone) {
      case "bad":
        // Solid red with white text (R-11 "Can't deliver"). The night red in both
        // schemes: the header is dark in both.
        surface = DANGER.dark.bg;
        ink = DANGER.dark.ink;
        break;
      case "good":
        surface = nightTone.good.surface;
        ink = nightTone.good.ink;
        break;
      case "warn":
        surface = nightTone.warn.surface;
        ink = nightTone.warn.ink;
        break;
      case "neutral":
        ink = HEADER.text;
        break;
    }
  } else {
    label = stepBadgeLabel(step);
  }

  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, backgroundColor: surface }}
    >
      <Text style={{ fontSize: 14, fontWeight: "700", color: ink }}>{label}</Text>
    </View>
  );
}

function trackerSpeech(labels: StepLabels, states: readonly TrackerState[]): string {
  return labels
    .map((label, i) => {
      const state = states[i];
      return `${label}, ${state === "done" ? "done" : state === "current" ? "current step" : "not started"}`;
    })
    .join(". ");
}

function Tracker({ step, labels }: { step: StepValue; labels: StepLabels }) {
  const { c } = useTheme();
  const states = stepTrackerState(step);
  return (
    <View
      accessible
      accessibilityLabel={trackerSpeech(labels, states)}
      style={{ marginTop: 16, flexDirection: "row", gap: 12 }}
    >
      {labels.map((label, i) => {
        const state = states[i]!;
        const bar =
          state === "done" ? nightTone.good.fg : state === "current" ? c.flame : HEADER.track;
        const ink =
          state === "done" ? nightTone.good.ink : state === "current" ? HEADER.text : HEADER.faint;
        return (
          <View key={label} style={{ flex: 1, gap: 6 }}>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: bar }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              {state === "done" ? <Icon name="check" size={14} color={ink} strokeWidth={2.6} /> : null}
              <Text
                numberOfLines={1}
                style={{ flexShrink: 1, fontSize: 15, fontWeight: state === "current" ? "700" : "500", color: ink }}
              >
                {label}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * The stop-flow header (R-04, R-07, R-09, R-11): back button, "Stop 2 · OUT074"
 * with a sub-line, the step badge, and EITHER the 3-segment step tracker OR a
 * plain info line ("Arrived 07:58 · window 03:00 – 08:00").
 *
 * `step` is 1, 2 or 3 ("Step N of 3"), "done" ("Done", every segment green), or a
 * custom badge such as `{label: "Can't deliver", tone: "bad"}` (then use
 * `infoLine`, not a tracker). `tracker` is `true` for the default labels
 * (Check items / Receipt / Confirm) or a triple of your own; it needs a numbered
 * or "done" step.
 */
export function StepHeader({
  stopNumber,
  outletId,
  subline,
  step,
  onBack,
  backLabel = "Back",
  tracker,
  infoLine,
}: {
  stopNumber: number;
  outletId: string;
  subline?: string;
  step: StepValue | StepBadgeSpec;
  onBack: () => void;
  backLabel?: string;
  tracker?: boolean | StepLabels;
  infoLine?: string;
}) {
  const labels: StepLabels | null =
    tracker === true ? DEFAULT_STEP_LABELS : tracker ? tracker : null;

  return (
    <Frame>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          style={({ pressed }) => ({
            width: 48,
            height: 48,
            borderRadius: 24,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? "rgba(255,255,255,0.22)" : HEADER.control,
          })}
        >
          <Icon name="arrow-left" size={24} color={HEADER.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            style={{ fontSize: 22, fontWeight: "700", color: HEADER.text, fontVariant: ["tabular-nums"] }}
          >
            {`Stop ${stopNumber} · ${outletId}`}
          </Text>
          {subline ? (
            <Text numberOfLines={1} style={{ fontSize: 15, color: HEADER.sub }}>
              {subline}
            </Text>
          ) : null}
        </View>
        <Badge step={step} />
      </View>

      {infoLine ? (
        <Text style={{ marginTop: 14, fontSize: 15, color: HEADER.sub, fontVariant: ["tabular-nums"] }}>
          {infoLine}
        </Text>
      ) : null}
      {labels && typeof step !== "object" ? <Tracker step={step} labels={labels} /> : null}
    </Frame>
  );
}
