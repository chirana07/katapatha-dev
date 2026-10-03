import { Modal, Pressable, Text, View } from "react-native";
import { radius, space } from "@katapatha/tokens/tokens";
import { Icon, type IconName } from "./Icon";
import { useInsets } from "./insets";
import { useTheme } from "./theme";
import { SCRIM } from "./tokens";

export type MenuItem = {
  label: string;
  onPress: () => void;
  icon?: IconName;
  /** Shown after the label ("3" unsent). */
  detail?: string;
  tone?: "default" | "critical";
};

/**
 * The ⋮ menu: a small card under the header's top-right corner. Tapping outside
 * or the system back closes it; choosing an item closes it first and then runs
 * the item, so a navigation never happens under an open modal.
 */
export function MenuSheet({
  visible,
  onClose,
  items,
  title = "Menu",
}: {
  visible: boolean;
  onClose: () => void;
  items: readonly MenuItem[];
  /** Read to a screen reader as the menu's name. */
  title?: string;
}) {
  const { c, tones } = useTheme();
  const { top } = useInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close menu"
        style={{ flex: 1, backgroundColor: SCRIM }}
      >
        <View
          accessibilityViewIsModal
          accessibilityLabel={title}
          style={{
            position: "absolute",
            top: top + 56,
            right: space.sm,
            minWidth: 240,
            borderRadius: radius.cardLoose,
            borderWidth: 1,
            borderColor: c.line,
            backgroundColor: c.surface,
            overflow: "hidden",
          }}
        >
          {items.map((item, index) => {
            const ink = item.tone === "critical" ? tones.bad.ink : c.ink;
            return (
              <Pressable
                key={item.label}
                onPress={() => {
                  onClose();
                  item.onPress();
                }}
                accessibilityRole="menuitem"
                accessibilityLabel={item.detail ? `${item.label}, ${item.detail}` : item.label}
                style={({ pressed }) => ({
                  minHeight: 52,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.xs + 4,
                  paddingHorizontal: space.sm,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: c.line,
                  backgroundColor: pressed ? c.canvas : c.surface,
                })}
              >
                {item.icon ? <Icon name={item.icon} size={20} color={ink} /> : null}
                <Text style={{ flex: 1, fontSize: 16, fontWeight: "600", color: ink }}>{item.label}</Text>
                {item.detail ? (
                  <Text style={{ fontSize: 14, color: c.muted, fontVariant: ["tabular-nums"] }}>{item.detail}</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </Pressable>
    </Modal>
  );
}
