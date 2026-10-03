import { Text, View } from "react-native";
import { Icon } from "./Icon";
import { STOP_BADGE_SPEC, type StopBadgeKind } from "./logic";
import { useTheme } from "./theme";

/**
 * The status chip at the right of a stop row (R-02, R-06, R-10): Delivered
 * (green), Next stop (flame), Upcoming (grey), Saved on phone (amber, phone icon).
 *
 * The label always renders with the colour. `saved` has no built-in label: the
 * words for "stored on this phone" come from src/outbox/claims.ts, so the screen
 * passes them in (the type requires it).
 */
export type StopBadgeProps =
  | { kind: "saved"; label: string }
  | { kind: Exclude<StopBadgeKind, "saved">; label?: string };

export function StopBadge(props: StopBadgeProps) {
  const { tones } = useTheme();
  const spec = STOP_BADGE_SPEC[props.kind];
  const style = tones[spec.tone];
  const label = props.label ?? spec.label ?? "";

  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingVertical: 5,
        paddingHorizontal: 10,
        borderRadius: 8,
        backgroundColor: style.surface,
        borderWidth: spec.tone === "warn" ? 1 : 0,
        borderColor: style.border,
      }}
    >
      {spec.icon ? <Icon name={spec.icon} size={14} color={style.ink} /> : null}
      <Text style={{ color: style.ink, fontSize: 13, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

/**
 * The round marker at the left of a stop row: a green tick when delivered, the
 * stop's number in flame when it is the next stop, a grey number when upcoming.
 * The number or the tick is always drawn, so the state is not carried by colour.
 */
export function StopMarker({
  state,
  number,
  size = 48,
}: {
  state: "done" | "current" | "upcoming" | "failed";
  number: number;
  size?: number;
}) {
  const { c, tones, tone } = useTheme();
  const fill =
    state === "done"
      ? tone.good.fg
      : state === "current"
        ? c.flame
        : state === "failed"
          ? tones.bad.fg
          : tones.neutral.surface;
  const ink = state === "current" ? tones.accent.ink : state === "upcoming" ? c.muted : "#FFFFFF";

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: fill,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {state === "done" ? (
        <Icon name="check" size={size * 0.5} color={ink} strokeWidth={2.6} />
      ) : state === "failed" ? (
        <Icon name="x" size={size * 0.45} color={ink} strokeWidth={2.6} />
      ) : (
        <Text style={{ fontSize: size * 0.4, fontWeight: "700", color: ink, fontVariant: ["tabular-nums"] }}>
          {number}
        </Text>
      )}
    </View>
  );
}
