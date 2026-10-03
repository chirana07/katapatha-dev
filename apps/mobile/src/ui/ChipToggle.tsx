import { Pressable, Text, View } from "react-native";
import { TOUCH_TARGET_MIN } from "@katapatha/tokens/tokens";
import { Icon } from "./Icon";
import { useTheme } from "./theme";

/**
 * A tickable chip (R-04 "All 4 corners", "Text sharp", "Signature visible").
 * Ticked shows a check on the good tone; unticked shows an empty ring on a plain
 * outline, so the state is a shape as well as a colour. It is the DRIVER's own
 * confirmation, never a machine verdict.
 */
export function ChipToggle({
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
  const { c, tones } = useTheme();
  const good = tones.good;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET_MIN,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? good.border : c.line,
        backgroundColor: selected ? good.surface : c.surface,
        opacity: pressed ? 0.85 : disabled ? 0.6 : 1,
      })}
    >
      {selected ? (
        <Icon name="check" size={18} color={good.ink} strokeWidth={2.6} />
      ) : (
        <View
          style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: c.muted }}
        />
      )}
      <Text style={{ fontSize: 15, fontWeight: "600", color: selected ? good.ink : c.ink }}>{label}</Text>
    </Pressable>
  );
}
