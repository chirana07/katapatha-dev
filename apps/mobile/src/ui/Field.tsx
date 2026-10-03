import { useState } from "react";
import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { radius, space, TOUCH_TARGET_MIN } from "@katapatha/tokens/tokens";
import { Icon } from "./Icon";
import { useTheme } from "./theme";

/**
 * A labelled text input, 48px high (never under 44). The border turns to the link
 * colour and thickens while focused, so focus is visible without colour alone
 * (docs/DESIGN.md "Focus rings are visible"). A field with `secureTextEntry` gets
 * a Show/Hide control; the secret is hidden again on every mount.
 */
export function Field({
  label,
  hint,
  error,
  style,
  secureTextEntry,
  onFocus,
  onBlur,
  ...rest
}: TextInputProps & { label: string; hint?: string; error?: string }) {
  const { c, tones } = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const border = error ? tones.bad.fg : focused ? c.link : c.line;

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 15, fontWeight: "600", color: c.ink }}>{label}</Text>
      <View
        style={{
          minHeight: 48,
          flexDirection: "row",
          alignItems: "center",
          borderWidth: focused || error ? 2 : 1,
          borderColor: border,
          borderRadius: radius.control + 4,
          backgroundColor: c.surface,
        }}
      >
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={c.muted}
          selectionColor={c.link}
          secureTextEntry={secureTextEntry && !revealed}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            {
              flex: 1,
              minHeight: 46,
              paddingHorizontal: space.xs + 6,
              fontSize: 16,
              color: c.ink,
            },
            style,
          ]}
          {...rest}
        />
        {secureTextEntry ? (
          <Pressable
            onPress={() => setRevealed((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            style={{
              width: TOUCH_TARGET_MIN,
              height: TOUCH_TARGET_MIN,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name={revealed ? "eye-off" : "eye"} size={22} color={c.muted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={{ fontSize: 13, color: tones.bad.ink }}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={{ fontSize: 13, color: c.muted }}>{hint}</Text>
      ) : null}
    </View>
  );
}
