import { Image, Pressable, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { radius, space } from "@katapatha/tokens/tokens";
import { Icon } from "@/ui/Icon";
import { useTheme, themeFor } from "@/ui/theme";
import { HEADER } from "@/ui/tokens";
import { MAX_POD_PAGES } from "@/outbox/intents";
import type { DraftPage } from "./pages";

/**
 * A stored signature is dark ink on a transparent background, read later on light
 * paper, so a signature page is always shown on paper-white, in night mode too.
 */
const PAPER = themeFor("light").c.surface;

export const PAGE_HELPER = "Add a page if the receipt has more than one sheet or a delivery note.";
export const PAGE_CAP_NOTE = `A delivery can carry at most ${MAX_POD_PAGES} pages.`;

const PREVIEW_HEIGHT = 320;
const BRACKET = 26;

/** The page image: a photo from its data URL, a signature from its SVG source. */
function PageImage({ page, fit }: { page: DraftPage; fit: "contain" | "cover" }) {
  if (page.kind === "SIGNATURE") {
    return (
      <View style={{ flex: 1, backgroundColor: PAPER, justifyContent: "center" }}>
        {page.previewXml ? (
          <SvgXml xml={page.previewXml} width="100%" height="100%" />
        ) : null}
      </View>
    );
  }
  return (
    <Image
      source={{ uri: page.data }}
      resizeMode={fit}
      accessibilityIgnoresInvertColors
      style={{ flex: 1 }}
    />
  );
}

function Bracket({ corner }: { corner: "tl" | "tr" | "bl" | "br" }) {
  const { c } = useTheme();
  const top = corner[0] === "t";
  const left = corner[1] === "l";
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: top ? space.xs + 2 : undefined,
        bottom: top ? undefined : space.xs + 2,
        left: left ? space.xs + 2 : undefined,
        right: left ? undefined : space.xs + 2,
        width: BRACKET,
        height: BRACKET,
        borderColor: c.flame,
        borderTopWidth: top ? 4 : 0,
        borderBottomWidth: top ? 0 : 4,
        borderLeftWidth: left ? 4 : 0,
        borderRightWidth: left ? 0 : 4,
        borderTopLeftRadius: top && left ? 6 : 0,
        borderTopRightRadius: top && !left ? 6 : 0,
        borderBottomLeftRadius: !top && left ? 6 : 0,
        borderBottomRightRadius: !top && !left ? 6 : 0,
      }}
    />
  );
}

function OverlayButton({
  label,
  accessibilityLabel,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  accessibilityLabel?: string;
  icon: "retake" | "x";
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        borderRadius: 999,
        // The header's navy, white text: legible over any photograph, in both schemes.
        backgroundColor: HEADER.surface,
        opacity: pressed ? 0.8 : disabled ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={18} color={HEADER.text} />
      <Text style={{ fontSize: 16, fontWeight: "700", color: HEADER.text }}>{label}</Text>
    </Pressable>
  );
}

/**
 * The selected page, aspect-fit in a card, with the corner brackets of a
 * receipt frame and the Retake / Remove controls over it.
 */
export function PagePreview({
  page,
  onRetake,
  onRemove,
  disabled,
}: {
  page: DraftPage;
  onRetake: () => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const { tones } = useTheme();
  const isPhoto = page.kind === "RECEIPT";
  return (
    <View
      style={{
        height: PREVIEW_HEIGHT,
        borderRadius: radius.cardLoose,
        overflow: "hidden",
        backgroundColor: tones.neutral.surface,
      }}
    >
      <PageImage page={page} fit="contain" />
      <Bracket corner="tl" />
      <Bracket corner="tr" />
      <Bracket corner="bl" />
      <Bracket corner="br" />
      <View
        style={{
          position: "absolute",
          top: space.xs + 2,
          right: space.xs + 2,
          flexDirection: "row",
          gap: space.xs,
        }}
      >
        {isPhoto ? <OverlayButton label="Retake" icon="retake" onPress={onRetake} disabled={disabled} /> : null}
        <OverlayButton
          label="Remove"
          accessibilityLabel="Remove page"
          icon="x"
          onPress={onRemove}
          disabled={disabled}
        />
      </View>
    </View>
  );
}

/** The empty state: one big tappable card that opens the camera. */
export function TakePhotoCard({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  const { c, tones } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Take a photo of the receipt"
      accessibilityHint="Opens the camera"
      style={({ pressed }) => ({
        minHeight: 220,
        borderRadius: radius.cardLoose,
        borderWidth: 2,
        borderStyle: "dashed",
        borderColor: c.line,
        backgroundColor: pressed ? c.canvas : c.surface,
        alignItems: "center",
        justifyContent: "center",
        gap: space.xs,
        padding: space.sm,
        opacity: disabled ? 0.6 : 1,
      })}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: tones.accent.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="camera" size={36} color={tones.accent.ink} />
      </View>
      <Text style={{ fontSize: 18, fontWeight: "700", color: c.ink }}>Take a photo of the receipt</Text>
      <Text style={{ fontSize: 14, color: c.muted, textAlign: "center" }}>
        Fit all four corners of the page in the frame.
      </Text>
    </Pressable>
  );
}

const TILE_W = 76;
const TILE_H = 96;

/**
 * The strip under the preview: a thumbnail per page (tap to select), a dashed
 * "Add page" tile while there is room, and the design's helper text. At the cap
 * the tile goes and a note says why.
 */
export function PageStrip({
  pages,
  selectedId,
  canAdd,
  onSelect,
  onAdd,
  disabled,
}: {
  pages: readonly DraftPage[];
  selectedId: string | null;
  canAdd: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs + 4 }}>
      {pages.map((page, index) => {
        const selected = page.id === selectedId;
        return (
          <Pressable
            key={page.id}
            onPress={() => onSelect(page.id)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${page.kind === "SIGNATURE" ? "Signature" : "Receipt"} page ${index + 1} of ${pages.length}`}
            accessibilityState={{ selected }}
            style={{
              width: TILE_W,
              height: TILE_H,
              borderRadius: radius.control + 2,
              overflow: "hidden",
              borderWidth: selected ? 3 : 1,
              borderColor: selected ? c.flame : c.line,
              backgroundColor: c.surface,
            }}
          >
            <PageImage page={page} fit="cover" />
          </Pressable>
        );
      })}
      {canAdd ? (
        <Pressable
          onPress={onAdd}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Add page"
          accessibilityHint="Opens the camera for another page"
          style={({ pressed }) => ({
            width: TILE_W,
            height: TILE_H,
            borderRadius: radius.control + 2,
            borderWidth: 2,
            borderStyle: "dashed",
            borderColor: c.muted,
            backgroundColor: pressed ? c.canvas : "transparent",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            opacity: disabled ? 0.6 : 1,
          })}
        >
          <Icon name="plus" size={26} color={c.ink} />
          <Text style={{ fontSize: 14, color: c.ink }}>Add page</Text>
        </Pressable>
      ) : null}
      <Text style={{ flex: 1, minWidth: 140, fontSize: 14, color: c.muted }}>
        {canAdd ? PAGE_HELPER : PAGE_CAP_NOTE}
      </Text>
    </View>
  );
}
