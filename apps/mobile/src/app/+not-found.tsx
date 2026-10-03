import { Link } from "expo-router";
import { Text, View } from "react-native";
import { space } from "@katapatha/tokens/tokens";
import { useInsets } from "@/ui/insets";
import { useTheme } from "@/ui/theme";

export default function NotFound() {
  const { c } = useTheme();
  const { top } = useInsets();
  return (
    <View
      style={{
        flex: 1,
        padding: space.md,
        paddingTop: space.md + top,
        gap: space.xs,
        backgroundColor: c.canvas,
      }}
    >
      <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: "700", color: c.ink }}>
        Nothing here
      </Text>
      <Text style={{ color: c.muted }}>That screen does not exist in this app.</Text>
      <Link
        href="/(driver)"
        style={{ color: c.link, fontSize: 16, paddingVertical: space.xs, minHeight: 44 }}
      >
        Back to the trip
      </Link>
    </View>
  );
}
