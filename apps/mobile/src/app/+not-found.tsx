import { Link } from "expo-router";
import { Text, View } from "react-native";
import { color, space } from "@katapatha/tokens/tokens";

export default function NotFound() {
  return (
    <View style={{ flex: 1, padding: space.md, gap: space.xs, backgroundColor: color.canvas }}>
      <Text style={{ fontSize: 20, fontWeight: "700", color: color.ink }}>
        Nothing here
      </Text>
      <Text style={{ color: color.muted }}>
        That screen does not exist in this app.
      </Text>
      <Link href="/(driver)" style={{ color: color.link, fontSize: 16, paddingVertical: space.xs }}>
        Back to today&apos;s run
      </Link>
    </View>
  );
}
