import { Pressable, Text, View } from "react-native";
import { radius, space, TOUCH_TARGET_MIN } from "@katapatha/tokens/tokens";
import { Icon, type IconName } from "./Icon";
import { useTheme } from "./theme";

export type BannerTone = "warn" | "good" | "info" | "bad";

const DEFAULT_ICON: Record<BannerTone, IconName> = {
  warn: "warning",
  good: "check",
  info: "info",
  bad: "warning",
};

/**
 * A message block: the Lamp Mode banner (warn, bulb), "Back online" (good), a
 * hint (info) or an error (bad). Icon, title and body carry the meaning; the tint
 * only supports them. The role follows urgency, copied from the web console: an
 * error is an `alert`, everything else a polite `status`, because announcing an
 * expired session or a saved confirmation as an emergency to a screen reader
 * mid-shift would be wrong.
 *
 * The words are the caller's. Anything about what is stored on the phone or sent
 * later comes from src/outbox/claims.ts, not from here.
 *
 * `compact` drops the icon disc and tightens the padding: the one-line form for
 * inline notes and the pinned sync bar ("3 updates waiting to sync | Try now").
 */
export function Banner({
  tone,
  icon,
  title,
  body,
  action,
  compact,
}: {
  tone: BannerTone;
  icon?: IconName;
  title?: string;
  body?: React.ReactNode;
  action?: { label: string; onPress: () => void; icon?: IconName; disabled?: boolean };
  compact?: boolean;
}) {
  const { tones, c } = useTheme();
  const style = tones[tone];
  const glyph = icon ?? DEFAULT_ICON[tone];

  return (
    <View
      accessibilityRole={tone === "bad" ? "alert" : undefined}
      accessibilityLiveRegion={tone === "bad" ? "assertive" : "polite"}
      accessible={false}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs + 4,
        backgroundColor: style.surface,
        borderWidth: 1,
        borderColor: style.border,
        borderRadius: compact ? radius.card + 2 : radius.cardLoose + 2,
        paddingVertical: compact ? space.xs + 2 : space.xs + 4,
        paddingHorizontal: compact ? space.xs + 4 : space.xs + 4,
      }}
    >
      {compact ? (
        <Icon name={glyph} size={22} color={style.fg} />
      ) : (
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: style.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={glyph} size={24} color={style.fg} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <Text style={{ fontSize: compact ? 15 : 16, fontWeight: "700", color: c.ink }}>{title}</Text>
        ) : null}
        {typeof body === "string" ? (
          <Text style={{ fontSize: 14, color: title ? c.muted : style.ink }}>{body}</Text>
        ) : (
          body
        )}
      </View>
      {action ? (
        <Pressable
          onPress={action.onPress}
          disabled={action.disabled}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={({ pressed }) => ({
            minHeight: TOUCH_TARGET_MIN,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 6,
            opacity: pressed ? 0.7 : action.disabled ? 0.5 : 1,
          })}
        >
          {action.icon ? <Icon name={action.icon} size={18} color={c.link} /> : null}
          <Text style={{ fontSize: 15, fontWeight: "700", color: c.link }}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
