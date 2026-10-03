import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { radius, space } from "@katapatha/tokens/tokens";
import { useTheme } from "./theme";
import type { Tone } from "./tokens";

/**
 * A bordered surface. `tone` tints it with a status tone (never colour alone: the
 * caller still writes the label); `highlight` is the flame outline on the next
 * stop. `flush` removes the padding, for a card made of rows with their own.
 */
export function Card({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  tone,
  highlight,
  flush,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  tone?: Tone;
  highlight?: boolean;
  flush?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, tones } = useTheme();
  const tinted = tone ? tones[tone] : null;

  const body = (
    <View
      style={[
        {
          backgroundColor: tinted ? tinted.surface : c.surface,
          borderRadius: radius.cardLoose,
          borderWidth: highlight ? 2 : 1,
          borderColor: highlight ? c.flame : tinted ? tinted.border : c.line,
          overflow: "hidden",
        },
        flush ? null : { padding: space.sm, gap: space.xs },
        style,
      ]}
    >
      {children}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
    >
      {body}
    </Pressable>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: "700", color: c.ink }}>
      {children}
    </Text>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return <Text style={{ fontSize: 14, color: c.muted }}>{children}</Text>;
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{
        fontSize: 12,
        fontWeight: "700",
        color: c.muted,
        letterSpacing: 0.6,
        textTransform: "uppercase",
      }}
    >
      {children}
    </Text>
  );
}

/**
 * A screen-level heading ("Today's stops (4)", "What stopped the delivery?",
 * "Receipt photo") with an optional trailing slot ("View on map", "Page 1 of 1").
 */
export function Heading({
  children,
  trailing,
}: {
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.xs }}>
      <Text
        accessibilityRole="header"
        style={{ flexShrink: 1, fontSize: 20, fontWeight: "700", color: c.ink }}
      >
        {children}
      </Text>
      {trailing}
    </View>
  );
}

/** A hairline between rows inside a flush Card. */
export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: 1, backgroundColor: c.line }} />;
}

/**
 * A label/value row for a summary card (R-09: Units, Received by, Receipt). Put
 * rows inside `<Card flush>` with a `<Divider />` between them. `value` may be a
 * string or a node (a Pill, for "Status").
 */
export function KeyValueRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.sm,
        paddingHorizontal: space.sm,
        paddingVertical: space.xs,
      }}
    >
      <Text style={{ fontSize: 15, color: c.muted }}>{label}</Text>
      {typeof value === "string" ? (
        <Text style={{ flexShrink: 1, textAlign: "right", fontSize: 15, fontWeight: "700", color: c.ink }}>
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );
}
