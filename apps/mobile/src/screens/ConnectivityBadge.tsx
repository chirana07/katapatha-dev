import { View, Text } from "react-native";
import { color, space } from "@katapatha/tokens/tokens";
import { useConnectivity } from "@/state/connectivity";
import { useOutboxCounts } from "@/state/useStore";
import { Numeric } from "@/ui/Numeric";

/**
 * The header badge: reachability, and how much is waiting.
 *
 * The wording is exactly Checking / Connected / Offline, which DESIGN.md
 * restricts it to, and it comes from a verified /health call rather than a radio
 * state. Dot plus text, never colour alone.
 *
 * The unsent count sits here because it is the one number a driver needs at a
 * glance all shift: it answers "has my work gone?" without opening a screen.
 */
export function ConnectivityBadge() {
  const { label } = useConnectivity();
  const counts = useOutboxCounts();

  const dot =
    label === "Connected" ? "#5FD08A" : label === "Offline" ? color.ochre : color.muted;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      {counts.unsent > 0 ? (
        <View
          accessibilityLabel={`${counts.unsent} records not yet sent`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 999,
            backgroundColor: color.flame,
          }}
        >
          <Numeric style={{ fontSize: 12, fontWeight: "700", color: color.ink }}>
            {counts.unsent}
          </Numeric>
          <Text style={{ fontSize: 12, fontWeight: "700", color: color.ink }}>unsent</Text>
        </View>
      ) : null}

      <View
        accessibilityLabel={`Connection: ${label}`}
        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
      >
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
        <Text style={{ color: color.surface, fontSize: 13, fontWeight: "600" }}>
          {label}
        </Text>
      </View>
    </View>
  );
}
