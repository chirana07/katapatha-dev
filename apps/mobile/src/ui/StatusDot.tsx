import { View, Text } from "react-native";
import { space } from "@katapatha/tokens/tokens";
import { STOP_STATUS_LABEL, STOP_STATUS_TONE, type StopStatus } from "../driver/stop-state";
import { useTheme } from "./theme";
import { toneTable } from "./tokens";

/**
 * A stop's status, as a dot AND its label.
 *
 * There is deliberately no prop that renders the dot alone, and no variant that
 * takes a colour. docs/DESIGN.md: "Status colour never appears without a label or
 * icon." Making that unexpressible in the type is the only way it stays true
 * after the tenth screen -- a reviewer cannot miss it, because there is nothing
 * else to call.
 *
 * The accessibility label repeats the status in words, so a screen reader
 * announces "Status: Delivered" rather than a bare colour swatch.
 */
export function StatusDot({
  status,
  suffix,
}: {
  status: StopStatus;
  /** Extra words after the label, e.g. "2 unsent". */
  suffix?: string;
}) {
  const { scheme } = useTheme();
  const tone = toneTable(scheme)[STOP_STATUS_TONE[status]];
  const label = STOP_STATUS_LABEL[status];
  const full = suffix ? `${label} · ${suffix}` : label;

  return (
    <View
      accessible
      accessibilityLabel={`Status: ${full}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        alignSelf: "flex-start",
        paddingVertical: 4,
        paddingHorizontal: space.xs + 2,
        borderRadius: 999,
        backgroundColor: tone.surface,
      }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone.dot }}
      />
      <Text style={{ color: tone.text, fontSize: 13, fontWeight: "600" }}>{label}</Text>
      {suffix ? <Text style={{ color: tone.text, fontSize: 13 }}>· {suffix}</Text> : null}
    </View>
  );
}
