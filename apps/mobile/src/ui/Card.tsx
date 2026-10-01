import { Pressable, Text, View } from "react-native";
import { color, radius, space } from "@katapatha/tokens/tokens";

export function Card({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const body = (
    <View
      style={{
        backgroundColor: color.surface,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: color.line,
        padding: space.sm,
        gap: space.xs,
      }}
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
      style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
    >
      {body}
    </Pressable>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontSize: 17, fontWeight: "700", color: color.ink }}>{children}</Text>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontSize: 14, color: color.muted }}>{children}</Text>;
}

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontSize: 12,
        fontWeight: "700",
        color: color.muted,
        letterSpacing: 0.6,
        textTransform: "uppercase",
      }}
    >
      {children}
    </Text>
  );
}
