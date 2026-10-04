import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Icon } from "@/ui/Icon";
import { useInsets } from "@/ui/insets";
import { StatusBarOnDark } from "@/ui/StatusBarStyle";
import { useTheme } from "@/ui/theme";
import { HEADER } from "@/ui/tokens";

/**
 * The plain titled header for the screens that are not a stop: Vehicle,
 * Connection, Unsent records. The same navy rounded block as `TripHeader` and
 * `StepHeader` (src/ui/Header.tsx), with a back arrow, a title, an optional
 * sub-line and an optional trailing node.
 *
 * `StepHeader` cannot express this (it is built around "Stop N · OUTxxx" and a
 * step badge), and its `Frame` is not exported, so the block is rebuilt here from
 * the same tokens. It is a candidate for promotion into src/ui.
 */
export function ScreenHeader({
  title,
  subtitle,
  onBack = goBack,
  trailing,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  trailing?: React.ReactNode;
}) {
  const { scheme } = useTheme();
  const { top } = useInsets();

  return (
    <View
      style={{
        backgroundColor: HEADER.surface,
        paddingTop: top + 12,
        paddingHorizontal: 16,
        paddingBottom: 16,
        borderBottomLeftRadius: 28,
        borderBottomRightRadius: 28,
        borderBottomWidth: 1,
        borderBottomColor: HEADER.edge[scheme],
      }}
    >
      <StatusBarOnDark />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => ({
            width: 48,
            height: 48,
            borderRadius: 24,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? "rgba(255,255,255,0.22)" : HEADER.control,
          })}
        >
          <Icon name="arrow-left" size={24} color={HEADER.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text
            accessibilityRole="header"
            numberOfLines={1}
            style={{ fontSize: 22, fontWeight: "700", color: HEADER.text }}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={2} style={{ fontSize: 15, color: HEADER.sub }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {trailing}
      </View>
    </View>
  );
}

/** Back, or the Trip screen when there is nothing to go back to (a screen opened first). */
function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace("/(driver)");
}
