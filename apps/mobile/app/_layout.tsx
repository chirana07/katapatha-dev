import { Stack } from "expo-router";
import { color } from "@katapatha/tokens/tokens";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: color.navy },
        headerTintColor: color.surface,
        contentStyle: { backgroundColor: color.canvas },
      }}
    />
  );
}
