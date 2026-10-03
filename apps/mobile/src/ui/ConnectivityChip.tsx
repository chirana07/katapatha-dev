import { Text, View } from "react-native";
import type { ConnectivityLabel } from "../state/connectivity";
import { Icon } from "./Icon";
import { CHIP_ON_NAVY } from "./tokens";

/**
 * The design's connectivity chip for the navy header: a dot and exactly
 * `Checking` / `Connected` / `Offline` (never "Online": docs/DESIGN.md), then a
 * wifi / wifi-off glyph. Presentational: it takes the label as a prop so a
 * harness can render all three, and `ConnectivityBadge` feeds it the verified
 * label from /health.
 *
 * The word carries the state; the dot and glyph colour only echo it, and the
 * glyph changes SHAPE between Offline and the others. It is a polite live
 * region so a change from Connected to Offline is announced.
 */
export function ConnectivityChip({ label }: { label: ConnectivityLabel }) {
  const style = CHIP_ON_NAVY[label];
  return (
    <View
      accessible
      accessibilityLabel={`Connection: ${label}`}
      accessibilityLiveRegion="polite"
      style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          minHeight: 32,
          paddingHorizontal: 12,
          borderRadius: 999,
          backgroundColor: style.surface,
        }}
      >
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: style.dot }} />
        <Text style={{ color: style.ink, fontSize: 14, fontWeight: "600" }}>{label}</Text>
      </View>
      <Icon name={label === "Offline" ? "wifi-off" : "wifi"} size={22} color={style.dot} />
    </View>
  );
}
