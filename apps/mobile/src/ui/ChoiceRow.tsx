import { Pressable, Text, View } from "react-native";
import { radius, space } from "@katapatha/tokens/tokens";
import { useTheme } from "./theme";

/**
 * One option in a pick-one list (R-11 "What stopped the delivery?"): a radio card.
 * The selected row is outlined in flame, tinted, and its radio is FILLED, so the
 * choice is shown by shape as well as colour. Wrap the rows in a
 * `<View accessibilityRole="radiogroup">`.
 */
export function ChoiceRow({
  label,
  description,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { c, tones } = useTheme();
  const accent = tones.warn;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, selected, disabled: !!disabled }}
      accessibilityLabel={description ? `${label}. ${description}` : label}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs + 6,
        paddingVertical: space.xs + 4,
        paddingHorizontal: space.sm,
        borderRadius: radius.cardLoose,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? c.flame : c.line,
        backgroundColor: selected ? accent.surface : c.surface,
        opacity: pressed ? 0.9 : disabled ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: selected ? accent.fg : c.muted,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: accent.fg }} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 17, fontWeight: "600", color: c.ink }}>{label}</Text>
        {description ? <Text style={{ fontSize: 14, color: c.muted }}>{description}</Text> : null}
      </View>
    </Pressable>
  );
}
