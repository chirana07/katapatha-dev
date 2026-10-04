import { View } from "react-native";
import { space } from "@katapatha/tokens/tokens";
import { Card, CardTitle, Muted } from "@/ui/Card";
import { SecondaryButton } from "@/ui/Button";
import { useInsets } from "@/ui/insets";
import { useTheme } from "@/ui/theme";
import { goToTrip } from "./nav";

/**
 * A stop id that is not on the cached run. There is no stop to put in a header,
 * so the card sits under the status bar on its own.
 */
export function StopNotFound({ detail }: { detail: string }) {
  const { c } = useTheme();
  const { top } = useInsets();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: c.canvas,
        padding: space.sm,
        paddingTop: space.sm + top,
        gap: space.sm,
      }}
    >
      <Card>
        <CardTitle>Stop not on this trip</CardTitle>
        <Muted>{detail}</Muted>
      </Card>
      {/* Buttons grow to fill their container's height; a plain wrapper keeps this one 52px. */}
      <View>
        <SecondaryButton label="Back to the trip" onPress={goToTrip} />
      </View>
    </View>
  );
}
