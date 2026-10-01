import { ScrollView, View, RefreshControl, type ViewStyle } from "react-native";
import { color, space } from "@katapatha/tokens/tokens";

/**
 * The page shell: one column, vertical scroll only.
 *
 * docs/DESIGN.md requires one column on a phone with no page-wide horizontal
 * scroll. There is no `horizontal` prop here and no horizontal ScrollView
 * anywhere in the app, so that cannot be introduced by a screen.
 *
 * `bottomInset` leaves room for ThumbBar, so a pinned dominant action never
 * covers the last card.
 */
export function Screen({
  children,
  onRefresh,
  refreshing,
  bottomInset = space.md,
  style,
}: {
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  bottomInset?: number;
  style?: ViewStyle;
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.canvas }}
      contentContainerStyle={{ padding: space.sm, paddingBottom: bottomInset, gap: space.sm }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh
          ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={color.navy} />
          : undefined
      }
    >
      <View style={[{ gap: space.sm }, style]}>{children}</View>
    </ScrollView>
  );
}
