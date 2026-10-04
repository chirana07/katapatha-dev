import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { space, TOUCH_TARGET_MIN } from "@katapatha/tokens/tokens";
import { Icon } from "@/ui/Icon";
import { Numeric } from "@/ui/Numeric";
import { useTheme } from "@/ui/theme";
import {
  asOrderedNote,
  itemsView,
  toggleLabel,
  type CachedItem,
} from "@/driver/order-items";

/**
 * What one order contains, under its row: "White Rice 5 kg · 12 bags".
 *
 * Read-only context. The count stays per order in units, so nothing here has a
 * control that counts a product and nothing says "missing" about one. A long
 * breakdown collapses to its first lines and "+N more" (tap to expand) so it
 * cannot push the order's stepper off a small screen.
 *
 * Renders nothing for an order with no breakdown: that is the normal case for a
 * units-only or competition order, not a gap to apologise for.
 */
export function OrderItemsList({
  orderRef,
  order,
  indent = 0,
}: {
  orderRef: string;
  order: {
    expectedUnits: number;
    orderedUnits?: number | null;
    items?: readonly CachedItem[];
  };
  /** Left inset, to line the list up under a row's text rather than its icon. */
  indent?: number;
}) {
  const { c } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const view = itemsView(order.items, expanded);
  if (view.lines.length === 0) return null;
  const note = asOrderedNote(order);
  const hiddenCount = (order.items?.length ?? 0) - view.lines.length;

  return (
    <View style={{ marginLeft: indent, gap: 2 }}>
      <View
        accessible
        accessibilityLabel={`Products in ${orderRef}: ${view.lines.join(", ")}`}
        style={{ gap: 2 }}
      >
        {view.lines.map((line, index) => (
          <Numeric
            key={`${index}:${line}`}
            style={{ fontSize: 14, lineHeight: 20, color: c.muted }}
          >
            {line}
          </Numeric>
        ))}
        {note ? <Text style={{ fontSize: 13, lineHeight: 18, color: c.muted }}>{note}</Text> : null}
      </View>
      {view.canToggle ? (
        <Pressable
          onPress={() => setExpanded((open) => !open)}
          accessibilityRole="button"
          accessibilityLabel={
            expanded
              ? `Show fewer products for ${orderRef}`
              : `Show ${hiddenCount} more ${hiddenCount === 1 ? "product" : "products"} for ${orderRef}`
          }
          accessibilityState={{ expanded }}
          hitSlop={4}
          style={{
            minHeight: TOUCH_TARGET_MIN,
            alignSelf: "flex-start",
            flexDirection: "row",
            alignItems: "center",
            gap: space.dense,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: "700", color: c.ink }}>
            {toggleLabel(view, expanded)}
          </Text>
          <View style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}>
            <Icon name="chevron-down" size={16} color={c.ink} strokeWidth={2.4} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}
