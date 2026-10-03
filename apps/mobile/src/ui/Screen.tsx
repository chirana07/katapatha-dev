import {
  KeyboardAvoidingView,
  RefreshControl,
  ScrollView,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { space } from "@katapatha/tokens/tokens";
import { useTheme } from "./theme";

/**
 * The page shell: one column, vertical scroll only.
 *
 * docs/DESIGN.md requires one column on a phone with no page-wide horizontal
 * scroll. There is no `horizontal` prop here and no horizontal ScrollView
 * anywhere in the app, so that cannot be introduced by a screen.
 *
 * Layout, top to bottom: `header` (a TripHeader / StepHeader, pinned), the scroll
 * area, then `footer` (a BottomBar, pinned). The footer is a sibling BELOW the
 * scroll area rather than an overlay, so it can never cover the last card on a
 * small screen, and a keyboard lifts it (KeyboardAvoidingView) so a field is not
 * hidden by it. The old absolutely-positioned `ThumbBar` still works; leave room
 * for it with `bottomInset`.
 */
export function Screen({
  children,
  header,
  footer,
  onRefresh,
  refreshing,
  bottomInset = space.md,
  style,
}: {
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Room under the content for an absolutely-positioned ThumbBar. */
  bottomInset?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();

  return (
    // "padding" on both platforms: Android 15+ draws edge to edge, where the
    // window no longer resizes for the keyboard, so adjustResize cannot be relied on.
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.canvas }}>
      {header}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.sm, paddingBottom: bottomInset, gap: space.sm }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.link} />
          ) : undefined
        }
      >
        <View style={[{ gap: space.sm }, style]}>{children}</View>
      </ScrollView>
      {footer}
    </KeyboardAvoidingView>
  );
}
