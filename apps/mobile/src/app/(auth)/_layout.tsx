import { Redirect, Stack } from "expo-router";
import { useSession } from "@/state/session";

export default function AuthLayout() {
  const { status } = useSession();

  // Already signed in: never show a sign-in form over a working run.
  if (status === "signed-in") return <Redirect href="/(driver)" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
