import { View, Text } from "react-native";
import { space } from "@katapatha/tokens/tokens";
import { Icon, type IconName } from "./Icon";
import { useTheme } from "./theme";
import type { Tone } from "./tokens";

/** A small labelled chip. Always carries text; never colour alone. */
export function Pill({
  label,
  tone = "neutral",
  icon,
  accessibilityLabel,
}: {
  label: string;
  tone?: Tone;
  /** Leading glyph, drawn in the tone's ink. */
  icon?: IconName;
  accessibilityLabel?: string;
}) {
  const { tones } = useTheme();
  const style = tones[tone];

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 5,
        paddingVertical: 4,
        paddingHorizontal: space.xs + 2,
        borderRadius: 999,
        backgroundColor: style.surface,
      }}
    >
      {icon ? <Icon name={icon} size={13} color={style.ink} /> : null}
      <Text style={{ color: style.ink, fontSize: 13, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}
