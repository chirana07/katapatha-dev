import { View, Text } from "react-native";
import { color, space } from "@katapatha/tokens/tokens";

/** A small labelled chip. Always carries text; never colour alone. */
export function Pill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "accent" | "warn";
}) {
  const surface =
    tone === "accent" ? color.navy : tone === "warn" ? "#FEF1F1" : color.raised;
  const text =
    tone === "accent" ? color.surface : tone === "warn" ? color.ruby : color.muted;

  return (
    <View
      style={{
        paddingVertical: 3,
        paddingHorizontal: space.xs,
        borderRadius: 999,
        backgroundColor: surface,
      }}
    >
      <Text style={{ color: text, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}
