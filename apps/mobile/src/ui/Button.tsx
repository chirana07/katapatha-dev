import { Pressable, Text, View, ActivityIndicator } from "react-native";
import { color, radius, space, TOUCH_TARGET_MIN } from "@katapatha/tokens/tokens";

/**
 * The only two buttons in the app.
 *
 * docs/DESIGN.md requires driver primary controls to be at least 44px high and
 * each view to have one visually dominant action, operable one-handed. There is
 * no third variant and no size prop, so a 32px control cannot appear on a screen
 * by someone reaching for a smaller button -- they would have to add a component,
 * which a reviewer sees.
 *
 * PrimaryButton is 48 to match the web console's dominant action; SecondaryButton
 * sits exactly on TOUCH_TARGET_MIN.
 */

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Replaces the label while an action is in flight. */
  busyLabel?: string;
  busy?: boolean;
};

export function PrimaryButton({ label, onPress, disabled, busy, busyLabel }: Props) {
  const inactive = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      style={({ pressed }) => ({
        minHeight: 48,
        borderRadius: radius.control,
        backgroundColor: inactive ? color.ochre : color.flame,
        opacity: pressed ? 0.9 : 1,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: space.xs,
        paddingHorizontal: space.sm,
      })}
    >
      {busy ? <ActivityIndicator size="small" color={color.ink} /> : null}
      <Text style={{ color: color.ink, fontSize: 17, fontWeight: "700" }}>
        {busy && busyLabel ? busyLabel : label}
      </Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
  busy,
  busyLabel,
  tone = "default",
}: Props & { tone?: "default" | "critical" }) {
  const inactive = disabled || busy;
  const critical = tone === "critical";
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET_MIN,
        borderRadius: radius.control,
        borderWidth: 1,
        // Destructive is recessive on purpose, as in the web console: reporting a
        // problem must never compete with completing the delivery.
        borderColor: critical ? "#F0B4B4" : color.line,
        backgroundColor: critical ? "#FEF1F1" : color.surface,
        opacity: pressed ? 0.9 : 1,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: space.xs,
        paddingHorizontal: space.sm,
      })}
    >
      {busy ? <ActivityIndicator size="small" color={color.muted} /> : null}
      <Text
        style={{
          color: critical ? color.ruby : color.ink,
          fontSize: 16,
          fontWeight: "600",
        }}
      >
        {busy && busyLabel ? busyLabel : label}
      </Text>
    </Pressable>
  );
}

/**
 * Pins exactly one dominant action in the thumb zone.
 *
 * `children` is a single node, not an array, because docs/DESIGN.md allows one
 * visually dominant action per view and two primary buttons side by side is the
 * usual way that rule gets broken.
 */
export function ThumbBar({ children }: { children: React.ReactElement }) {
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        padding: space.sm,
        paddingBottom: space.md,
        backgroundColor: color.surface,
        borderTopWidth: 1,
        borderTopColor: color.line,
      }}
    >
      {children}
    </View>
  );
}
