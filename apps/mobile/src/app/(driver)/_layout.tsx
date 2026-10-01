import { Redirect, Stack } from "expo-router";
import { Text, View } from "react-native";
import { color, space } from "@katapatha/tokens/tokens";
import { useSession } from "@/state/session";
import { ConnectivityBadge } from "@/screens/ConnectivityBadge";

/**
 * The guard.
 *
 * A missing session redirects to sign-in. A session belonging to someone who is
 * not a driver gets an explanation instead of a redirect: bouncing them between
 * two layouts would loop, and the honest answer is that this app is the driver
 * app.
 *
 * `loading` renders nothing rather than redirecting, because the session starts
 * as loading on every launch and redirecting on it would flash the sign-in screen
 * at a driver who is already signed in.
 */
export default function DriverLayout() {
  const { status, user } = useSession();

  if (status === "loading") return null;
  if (status === "signed-out") return <Redirect href="/(auth)/sign-in" />;

  if (user && user.role !== "DRIVER") return <WrongRole role={user.role} />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: color.navy },
        headerTintColor: color.surface,
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: color.canvas },
        headerRight: () => <ConnectivityBadge />,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Today's run" }} />
      <Stack.Screen name="vehicle" options={{ title: "Vehicle" }} />
      <Stack.Screen name="outbox" options={{ title: "Unsent records" }} />
      <Stack.Screen name="connection" options={{ title: "Connection" }} />
      <Stack.Screen name="stops/[stopId]/index" options={{ title: "Stop" }} />
      <Stack.Screen name="stops/[stopId]/deliver" options={{ title: "Complete delivery" }} />
      <Stack.Screen name="stops/[stopId]/problem" options={{ title: "Report a problem" }} />
    </Stack>
  );
}

function WrongRole({ role }: { role: string }) {
  return (
    <View style={{ flex: 1, padding: space.md, gap: space.xs, backgroundColor: color.canvas }}>
      <Text style={{ fontSize: 20, fontWeight: "700", color: color.ink }}>
        This is the driver app
      </Text>
      <Text style={{ color: color.muted }}>
        This account is a {role.toLowerCase().replace("_", " ")}. Use the Katapatha web
        console for that role; this app only shows a driver&apos;s run.
      </Text>
    </View>
  );
}
