import { Text, TextInput, View, type TextInputProps } from "react-native";
import { color, radius, space, TOUCH_TARGET_MIN } from "@katapatha/tokens/tokens";

/** A labelled text input. At least 44px high, like every other control. */
export function Field({
  label,
  hint,
  style,
  ...rest
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 14, fontWeight: "600", color: color.ink }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={color.muted}
        style={[
          {
            minHeight: TOUCH_TARGET_MIN,
            borderWidth: 1,
            borderColor: color.line,
            borderRadius: radius.control,
            paddingHorizontal: space.xs,
            fontSize: 16,
            color: color.ink,
            backgroundColor: color.surface,
          },
          style,
        ]}
        {...rest}
      />
      {hint ? <Text style={{ fontSize: 13, color: color.muted }}>{hint}</Text> : null}
    </View>
  );
}
