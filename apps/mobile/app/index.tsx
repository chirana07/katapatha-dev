import { Text, View } from "react-native";
import { color, space } from "@katapatha/tokens/tokens";

export default function Index() {
  return (
    <View style={{ flex: 1, padding: space.md, gap: space.xs }}>
      <Text style={{ fontSize: 20, fontWeight: "600", color: color.ink }}>
        Katapatha Driver
      </Text>
      <Text style={{ color: color.muted }}>
        Scaffold in place. MOB1 owns src/outbox and auth; MOB2 owns src/screens.
      </Text>
    </View>
  );
}
