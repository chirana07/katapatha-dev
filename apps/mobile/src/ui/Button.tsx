import { Pressable, Text, View, ActivityIndicator } from "react-native";
import { radius, space, TOUCH_TARGET_MIN } from "@katapatha/tokens/tokens";
import { Icon, type IconName } from "./Icon";
import { useInsets } from "./insets";
import { useTheme } from "./theme";
import { DANGER } from "./tokens";

/**
 * The buttons in the app: Primary (flame, the one dominant action), Secondary,
 * Danger (the one destructive dominant action, R-11), Ghost (small, in-card) and
 * Link (text only).
 *
 * docs/DESIGN.md requires driver primary controls to be at least 44px high and
 * each view to have one visually dominant action, operable one-handed. There is
 * no size prop, so a 32px control cannot appear on a screen by someone reaching
 * for a smaller button -- they would have to add a component, which a reviewer
 * sees. PrimaryButton and DangerButton are 52; the rest sit on 44 or above.
 *
 * Every button grows to fill its container's height (`flexGrow`), so Back and the
 * dominant action in a BottomBar stay the same height as one another.
 */

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Replaces the label while an action is in flight. */
  busyLabel?: string;
  busy?: boolean;
  icon?: IconName;
  /** Defaults to the label. */
  accessibilityLabel?: string;
  /** What the control does, or why it is disabled. Read after the label. */
  accessibilityHint?: string;
};

const DOMINANT_HEIGHT = 52;

function Content({
  props,
  ink,
  size = 16,
  weight = "600",
  iconSize = 20,
}: {
  props: Props;
  ink: string;
  size?: number;
  weight?: "600" | "700";
  iconSize?: number;
}) {
  const { busy, busyLabel, label, icon } = props;
  return (
    <>
      {busy ? (
        <ActivityIndicator size="small" color={ink} />
      ) : icon ? (
        <Icon name={icon} size={iconSize} color={ink} />
      ) : null}
      <Text style={{ color: ink, fontSize: size, fontWeight: weight, flexShrink: 1, textAlign: "center" }}>
        {busy && busyLabel ? busyLabel : label}
      </Text>
    </>
  );
}

function a11y(props: Props) {
  const inactive = props.disabled || props.busy;
  return {
    accessibilityRole: "button" as const,
    accessibilityLabel: props.accessibilityLabel ?? props.label,
    accessibilityHint: props.accessibilityHint,
    accessibilityState: { disabled: !!inactive, busy: !!props.busy },
  };
}

export function PrimaryButton(props: Props) {
  const { c, tones } = useTheme();
  const inactive = props.disabled || props.busy;
  // Disabled is a grey fill with muted ink: the unmet condition is explained next
  // to the button by the screen (docs/DESIGN.md), not by colour.
  const ink = props.disabled ? c.muted : tones.accent.ink;
  return (
    <Pressable
      {...a11y(props)}
      onPress={props.onPress}
      disabled={inactive}
      style={({ pressed }) => ({
        minHeight: DOMINANT_HEIGHT,
        flexGrow: 1,
        borderRadius: radius.control + 4,
        backgroundColor: props.disabled ? c.line : c.flame,
        opacity: pressed ? 0.88 : 1,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: space.xs,
        paddingHorizontal: space.sm,
      })}
    >
      <Content props={props} ink={ink} size={17} weight="700" />
    </Pressable>
  );
}

export function SecondaryButton({
  tone = "default",
  ...props
}: Props & { tone?: "default" | "critical" }) {
  const { c, tones } = useTheme();
  const inactive = props.disabled || props.busy;
  const critical = tone === "critical";
  // Destructive is recessive on purpose, as in the web console: reporting a
  // problem must never compete with completing the delivery.
  const ink = props.disabled ? c.muted : critical ? tones.bad.ink : c.ink;
  return (
    <Pressable
      {...a11y(props)}
      onPress={props.onPress}
      disabled={inactive}
      style={({ pressed }) => ({
        minHeight: DOMINANT_HEIGHT - 4,
        flexGrow: 1,
        borderRadius: radius.control + 4,
        borderWidth: 1,
        borderColor: critical ? tones.bad.border : c.line,
        backgroundColor: critical ? tones.bad.surface : c.surface,
        opacity: pressed ? 0.88 : props.disabled ? 0.7 : 1,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: space.xs,
        paddingHorizontal: space.sm,
      })}
    >
      <Content props={props} ink={ink} />
    </Pressable>
  );
}

/** Solid red. The one destructive dominant action ("Record failed delivery", R-11). */
export function DangerButton(props: Props) {
  const { scheme, c } = useTheme();
  const solid = DANGER[scheme];
  const inactive = props.disabled || props.busy;
  return (
    <Pressable
      {...a11y(props)}
      onPress={props.onPress}
      disabled={inactive}
      style={({ pressed }) => ({
        minHeight: DOMINANT_HEIGHT,
        flexGrow: 1,
        borderRadius: radius.control + 4,
        backgroundColor: props.disabled ? c.line : solid.bg,
        opacity: pressed ? 0.88 : 1,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: space.xs,
        paddingHorizontal: space.sm,
      })}
    >
      <Content props={props} ink={props.disabled ? c.muted : solid.ink} size={17} weight="700" />
    </Pressable>
  );
}

/**
 * A small in-card action on a recessed fill ("Report issue", "View on map"). Still
 * 44px high: small to look at, not to hit.
 */
export function GhostButton(props: Props) {
  const { c } = useTheme();
  const inactive = props.disabled || props.busy;
  return (
    <Pressable
      {...a11y(props)}
      onPress={props.onPress}
      disabled={inactive}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET_MIN,
        flexGrow: 1,
        borderRadius: radius.control + 2,
        backgroundColor: c.canvas,
        opacity: pressed ? 0.8 : props.disabled ? 0.6 : 1,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        paddingHorizontal: space.xs + 4,
      })}
    >
      <Content props={props} ink={c.ink} size={15} iconSize={18} />
    </Pressable>
  );
}

/** Text only, in the link colour: a tertiary option such as "Skip this stop". */
export function LinkButton({
  tone = "default",
  ...props
}: Props & { tone?: "default" | "critical" }) {
  const { c, tones } = useTheme();
  const inactive = props.disabled || props.busy;
  const ink = props.disabled ? c.muted : tone === "critical" ? tones.bad.ink : c.link;
  return (
    <Pressable
      {...a11y(props)}
      onPress={props.onPress}
      disabled={inactive}
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET_MIN,
        alignSelf: "center",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 6,
        paddingHorizontal: space.xs,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Content props={props} ink={ink} size={15} iconSize={18} />
    </Pressable>
  );
}

/**
 * Pins exactly one dominant action in the thumb zone, over the page.
 *
 * `children` is a single node, not an array, because docs/DESIGN.md allows one
 * visually dominant action per view and two primary buttons side by side is the
 * usual way that rule gets broken. It is absolutely positioned, so the screen
 * must leave room (`Screen bottomInset`). Prefer `BottomBar` through
 * `Screen footer`, which sits below the scroll area instead of over it and so
 * cannot cover the last card on a small screen.
 */
export function ThumbBar({ children }: { children: React.ReactElement }) {
  const { c } = useTheme();
  const { bottom } = useInsets();
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        padding: space.sm,
        paddingBottom: space.sm + bottom,
        backgroundColor: c.surface,
        borderTopWidth: 1,
        borderTopColor: c.line,
      }}
    >
      {children}
    </View>
  );
}

/**
 * The pinned action row at the foot of a stop-flow screen: a secondary action on
 * the left ("Back") and ONE dominant action on the right ("Complete delivery"),
 * as in R-04. Pass it as `Screen footer`.
 *
 * `primary` is a single element and `secondary` is optional, which keeps the
 * one-dominant-action rule: a second flame button cannot be added here. `note`
 * sits above the row for the line that explains a disabled primary.
 */
export function BottomBar({
  primary,
  secondary,
  note,
  split = "back",
}: {
  primary: React.ReactElement;
  secondary?: React.ReactElement;
  note?: React.ReactNode;
  /** "back": a narrow secondary beside a wide dominant action (R-04). "even": two equal halves (the Trip row). */
  split?: "back" | "even";
}) {
  const { c } = useTheme();
  const { bottom } = useInsets();
  return (
    <View
      style={{
        backgroundColor: c.canvas,
        borderTopWidth: 1,
        borderTopColor: c.line,
        paddingTop: space.xs + 4,
        paddingHorizontal: space.sm,
        paddingBottom: space.xs + bottom,
        gap: space.xs,
      }}
    >
      {note ? <View>{note}</View> : null}
      <View style={{ flexDirection: "row", gap: space.xs + 4, alignItems: "stretch" }}>
        {secondary ? <View style={{ flex: split === "even" ? 1 : 0.38 }}>{secondary}</View> : null}
        <View style={{ flex: 1 }}>{primary}</View>
      </View>
    </View>
  );
}
