import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { color, space } from "@katapatha/tokens/tokens";
import { useSession } from "@/state/session";
import { useRunActions } from "@/state/useStore";
import { Screen } from "@/ui/Screen";
import { Card, CardTitle, Muted } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { PrimaryButton } from "@/ui/Button";
import { ErrorNote, InfoNote } from "@/ui/Notes";

/**
 * Sign in.
 *
 * The depot phone is shared, so the email is not remembered between sessions.
 *
 * Every failure gets its own sentence. "Invalid" and "could not reach the server"
 * look identical to a driver standing in a yard unless the app distinguishes
 * them, and the actions they should take are opposite: check the password, or
 * move and try again.
 */
export function SignInScreen() {
  const { signIn, expired } = useSession();
  const { bootstrap } = useRunActions();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setError(null);

    if (!email.trim() || !password) {
      setError("Enter the email and password from your depot card.");
      return;
    }

    setBusy(true);
    const result = await signIn({ email, password });
    setBusy(false);

    switch (result.kind) {
      case "ok":
        // Fetch the run before leaving, so the list is not empty on arrival.
        void bootstrap();
        router.replace("/(driver)");
        return;
      case "invalid":
        setError("That email and password do not match. Check your depot card.");
        return;
      case "throttled":
        setError(
          result.retryAfterSeconds
            ? `Too many attempts. Wait ${result.retryAfterSeconds} seconds and try again.`
            : "Too many attempts. Wait a moment and try again.",
        );
        return;
      case "not-a-driver":
        setError(
          `This account is a ${result.role.toLowerCase().replace("_", " ")}. This app only shows a driver's run.`,
        );
        return;
      case "offline":
        setError(
          "Katapatha could not be reached from this phone. Check the signal and try again.",
        );
        return;
      case "server":
        setError("Katapatha is temporarily unavailable. Try again shortly.");
        return;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.canvas }}>
      <Screen>
        <View style={{ paddingTop: space.lg, gap: space.dense }}>
          <Text style={{ fontSize: 26, fontWeight: "700", color: color.ink }}>
            Katapatha
          </Text>
          <Muted>Driver</Muted>
        </View>

        {expired ? (
          <InfoNote>
            Your session ended. Sign in again — anything you recorded is still on this
            phone.
          </InfoNote>
        ) : null}

        <Card>
          <CardTitle>Sign in</CardTitle>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            placeholder="you@waypoint.lk"
            editable={!busy}
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            textContentType="password"
            editable={!busy}
            onSubmitEditing={() => void submit()}
            returnKeyType="go"
          />
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <PrimaryButton
            label="Sign in"
            busyLabel="Signing in…"
            busy={busy}
            onPress={() => void submit()}
          />
        </Card>

        <Muted>
          This phone stays signed in for 30 days, so a stretch with no coverage does
          not sign you out.
        </Muted>
      </Screen>
    </View>
  );
}
