import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { radius, space } from "@katapatha/tokens/tokens";
import { useSession } from "@/state/session";
import { useRunActions } from "@/state/useStore";
import { Field } from "@/ui/Field";
import { Icon } from "@/ui/Icon";
import { useInsets } from "@/ui/insets";
import { ErrorNote } from "@/ui/Notes";
import { StatusBarOnDark } from "@/ui/StatusBarStyle";
import { useTheme } from "@/ui/theme";
import { DANGER, HEADER, SCRIM } from "@/ui/tokens";
import { sessionEndedNotice, signInNote, signInSubcopy } from "@/outbox/claims";
import { Banner } from "@/ui/Banner";

// The white-wordmark lockup: the file name says which SURFACE it suits (docs/DESIGN.md).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOCKUP = require("../../assets/katapatha-lockup-dark.png") as number;

/**
 * Sign in (R-01): a navy hero with the brand and the promise, and a sheet with
 * the fields.
 *
 * The depot phone is shared, so the email is not remembered between sessions.
 * The API authenticates email and password, so the fields are those, not the
 * design's staff ID and PIN.
 *
 * Every failure gets its own sentence. "Invalid" and "could not reach the server"
 * look identical to a driver standing in a yard unless the app distinguishes
 * them, and the actions they should take are opposite: check the password, or
 * move and try again.
 *
 * The hero is layered views (no gradient dependency): a darkening wash over navy
 * and a few translucent ruby discs for the glow in the corner. It is dark in both
 * colour schemes, like the navy header on every other screen.
 */
export function SignInScreen() {
  const { signIn, expired } = useSession();
  const { bootstrap } = useRunActions();
  const { c, tones } = useTheme();
  const { top, bottom } = useInsets();
  const { width, height } = useWindowDimensions();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const compact = height < 700 || width < 340;
  const headline = Math.round(Math.min(44, Math.max(30, width * 0.108)));

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

  const tile = compact ? 72 : 96;

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: HEADER.surface }}>
      <StatusBarOnDark />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        bounces={false}
      >
        <View
          style={{
            flexGrow: 1,
            backgroundColor: HEADER.surface,
            overflow: "hidden",
            paddingTop: top + 16,
            paddingHorizontal: 24,
            paddingBottom: 28 + 24,
            justifyContent: "space-between",
            gap: compact ? 20 : 32,
          }}
        >
          <Hero />
          <View style={{ alignItems: "flex-end" }}>
            <Image
              source={LOCKUP}
              accessibilityLabel="Katapatha"
              resizeMode="contain"
              style={{ width: 132, height: Math.round((132 * 409) / 1600) }}
            />
          </View>

          <View style={{ gap: compact ? 12 : 18 }}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                width: tile,
                height: tile,
                borderRadius: tile / 4,
                backgroundColor: HEADER.control,
                borderWidth: 1,
                borderColor: HEADER.outline,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="truck" size={tile / 2} color={c.flame} />
            </View>
            <Text
              style={{
                fontSize: 15,
                fontWeight: "700",
                letterSpacing: 2.2,
                color: c.flame,
              }}
            >
              KATAPATHA / DRIVER
            </Text>
            <Text
              accessibilityRole="header"
              style={{
                fontSize: headline,
                lineHeight: Math.round(headline * 1.12),
                fontWeight: "800",
                color: HEADER.text,
              }}
            >
              {"The next stop,\nalways in view."}
            </Text>
            <Text style={{ fontSize: 17, lineHeight: 25, color: HEADER.sub }}>
              {signInSubcopy()}
            </Text>
          </View>
        </View>

        <View
          style={{
            marginTop: -28,
            backgroundColor: c.canvas,
            borderTopLeftRadius: 32,
            borderTopRightRadius: 32,
            paddingHorizontal: 24,
            paddingTop: 12,
            paddingBottom: space.sm + bottom,
            gap: space.xs + 4,
          }}
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              alignSelf: "center",
              width: 56,
              height: 5,
              borderRadius: 3,
              backgroundColor: c.line,
              marginBottom: 6,
            }}
          />
          <View style={{ gap: 4 }}>
            <Text
              style={{ fontSize: 14, fontWeight: "700", letterSpacing: 2.2, color: c.muted }}
            >
              ON THE ROAD · PHONE
            </Text>
            <Text
              accessibilityRole="header"
              style={{ fontSize: 30, fontWeight: "800", color: c.ink }}
            >
              Sign in to driver
            </Text>
            <Text style={{ fontSize: 16, color: c.muted }}>
              Enter your Waypoint email and password.
            </Text>
          </View>

          {expired ? <Banner compact tone="info" body={sessionEndedNotice()} /> : null}

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
            placeholder="Enter your password"
            editable={!busy}
            onSubmitEditing={() => void submit()}
            returnKeyType="go"
          />
          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <Pressable
            onPress={() => void submit()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Open driver workspace"
            accessibilityState={{ disabled: busy, busy }}
            style={({ pressed }) => ({
              minHeight: 56,
              borderRadius: radius.control + 6,
              backgroundColor: HEADER.surface,
              borderWidth: 1,
              borderColor: HEADER.outline,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: space.xs + 2,
              opacity: pressed ? 0.88 : 1,
            })}
          >
            {busy ? <ActivityIndicator size="small" color={HEADER.text} /> : null}
            <Text style={{ fontSize: 17, fontWeight: "700", color: HEADER.text }}>
              {busy ? "Signing in…" : "Open driver workspace"}
            </Text>
            {busy ? null : <Icon name="arrow-right" size={20} color={HEADER.text} />}
          </Pressable>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs + 2,
              padding: space.xs + 4,
              borderRadius: radius.card + 2,
              backgroundColor: tones.neutral.surface,
            }}
          >
            <Icon name="bulb" size={22} color={tones.warn.fg} />
            <Text style={{ flex: 1, fontSize: 15, color: c.muted }}>{signInNote()}</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * The hero's backdrop: a darkening wash and a ruby glow in the top-right corner,
 * built from translucent discs because the design's radial gradient has no
 * dependency here. Purely decorative, so hidden from screen readers.
 */
function Hero() {
  const discs = [560, 440, 330, 230, 140];
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: SCRIM }} />
      {discs.map((size) => (
        <View
          key={size}
          style={{
            position: "absolute",
            top: -size * 0.55,
            right: -size * 0.5,
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: DANGER.light.bg,
            opacity: 0.07,
          }}
        />
      ))}
    </View>
  );
}
