import { Text, View } from "react-native";
import { color, radius, space } from "@katapatha/tokens/tokens";

/**
 * Inline messages.
 *
 * The role split matters and is copied from the web console: an error is an
 * `alert`, but an expired session or a saved confirmation is a `status`. An
 * expired session is not an emergency, and announcing it as one to a screen
 * reader mid-shift would be wrong.
 */

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: "#FEF1F1",
        borderWidth: 1,
        borderColor: "#F0B4B4",
        borderRadius: radius.control,
        padding: space.xs,
      }}
    >
      <Text style={{ color: color.ruby, fontSize: 14 }}>{children}</Text>
    </View>
  );
}

export function SavedNote({ children }: { children: React.ReactNode }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: "#ECFDF3",
        borderWidth: 1,
        borderColor: "#A9E2C1",
        borderRadius: radius.control,
        padding: space.xs,
      }}
    >
      <Text style={{ color: "#115C3A", fontSize: 14 }}>{children}</Text>
    </View>
  );
}

/** Advisory: true, worth saying, not a failure. */
export function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: "#FEF6E0",
        borderWidth: 1,
        borderColor: "#F3DCA0",
        borderRadius: radius.control,
        padding: space.xs,
      }}
    >
      <Text style={{ color: "#6B4E09", fontSize: 14 }}>{children}</Text>
    </View>
  );
}
