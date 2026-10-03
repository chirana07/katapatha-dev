import { Redirect, Stack } from "expo-router";
import { Text, View } from "react-native";
import { space } from "@katapatha/tokens/tokens";
import { useSession } from "@/state/session";
import { useInsets } from "@/ui/insets";
import { useTheme } from "@/ui/theme";

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
 *
 * The screens draw their own headers (TripHeader / StepHeader from src/ui), so
 * the navigator has none: `headerShown: false`. The connectivity chip lives in
 * those headers.
 */
export default function DriverLayout() {
  const { status, user } = useSession();
  const { c } = useTheme();

  if (status === "loading") return null;
  if (status === "signed-out") return <Redirect href="/(auth)/sign-in" />;

  if (user && user.role !== "DRIVER") return <WrongRole role={user.role} />;

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.canvas } }} />;
}

function WrongRole({ role }: { role: string }) {
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
        This is the driver app
      </Text>
      <Text style={{ color: c.muted }}>
        This account is a {role.toLowerCase().replace("_", " ")}. Use the Katapatha web
        console for that role; this app only shows a driver&apos;s run.
      </Text>
    </View>
  );
}
