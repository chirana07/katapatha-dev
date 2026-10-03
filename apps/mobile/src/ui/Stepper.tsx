import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { radius } from "@katapatha/tokens/tokens";
import { Icon } from "./Icon";
import { nudgeCount, parseCount } from "./logic";
import { useTheme } from "./theme";

const TARGET = 48;

/**
 * A count with − and + (R-07): the number between them is tappable and opens the
 * number pad, so 24 units to 3 is one entry, not 21 taps.
 *
 * Every control says WHAT is being counted in its accessibility label ("Decrease
 * units received for S1-082"): a bare "minus" button means nothing to a screen
 * reader, and a screen has several steppers. `label` is that noun phrase.
 *
 * The value is controlled. A typed entry that is not a whole number is dropped
 * and the previous value kept (never recorded as something the driver did not
 * type); one outside [min, max] is held to the nearest bound.
 */
export function Stepper({
  value,
  onChange,
  label,
  min = 0,
  max,
  disabled,
}: {
  value: number;
  onChange: (next: number) => void;
  /** What is counted, as a phrase: "units received for S1-082". */
  label: string;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  const atMin = value <= min;
  const atMax = max !== undefined && value >= max;

  const commit = () => {
    if (draft !== null) {
      const parsed = parseCount(draft, min, max);
      if (parsed !== null && parsed !== value) onChange(parsed);
    }
    setDraft(null);
  };

  const button = (kind: "minus" | "plus") => {
    const off = disabled || (kind === "minus" ? atMin : atMax);
    return (
      <Pressable
        onPress={() => onChange(nudgeCount(value, kind === "minus" ? -1 : 1, min, max))}
        disabled={off}
        accessibilityRole="button"
        accessibilityLabel={`${kind === "minus" ? "Decrease" : "Increase"} ${label}`}
        accessibilityState={{ disabled: !!off }}
        hitSlop={4}
        style={({ pressed }) => ({
          width: TARGET,
          height: TARGET,
          borderRadius: radius.cardLoose - 2,
          borderWidth: 1,
          borderColor: c.line,
          backgroundColor: pressed ? c.canvas : c.surface,
          opacity: off ? 0.4 : 1,
          alignItems: "center",
          justifyContent: "center",
        })}
      >
        <Icon name={kind === "minus" ? "minus" : "plus"} size={22} color={c.ink} strokeWidth={2.6} />
      </Pressable>
    );
  };

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      {button("minus")}
      {editing ? (
        <TextInput
          autoFocus
          value={draft}
          onChangeText={(text) => setDraft(text.replace(/[^\d]/g, "").slice(0, 6))}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="number-pad"
          returnKeyType="done"
          selectTextOnFocus
          accessibilityLabel={label}
          style={{
            minWidth: 56,
            height: TARGET,
            textAlign: "center",
            fontSize: 22,
            fontWeight: "700",
            color: c.ink,
            borderBottomWidth: 2,
            borderBottomColor: c.link,
            fontVariant: ["tabular-nums"],
          }}
        />
      ) : (
        <Pressable
          onPress={() => setDraft(String(value))}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${value}`}
          accessibilityHint="Opens the number pad to type a count"
          style={{ minWidth: 56, minHeight: TARGET, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ fontSize: 22, fontWeight: "700", color: c.ink, fontVariant: ["tabular-nums"] }}>
            {value}
          </Text>
        </Pressable>
      )}
      {button("plus")}
    </View>
  );
}
