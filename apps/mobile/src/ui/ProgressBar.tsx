import { Text, View } from "react-native";
import { HEADER } from "./tokens";
import { progressLabel, progressPercent } from "./logic";
import { useTheme } from "./theme";

/**
 * "1 of 4 stops completed ... 25%" over a flame-on-track bar.
 *
 * `onNavy` is the header form (white text, translucent track); without it the
 * bar sits on a page surface. The count and the percentage are text, so the
 * fill is never the only carrier of the figure.
 */
export function ProgressBar({
  done,
  total,
  label,
  onNavy,
}: {
  done: number;
  total: number;
  /** Replaces "N of M stops completed". */
  label?: string;
  onNavy?: boolean;
}) {
  const { c } = useTheme();
  const percent = progressPercent(done, total);
  const text = label ?? progressLabel(done, total);
  const ink = onNavy ? HEADER.text : c.ink;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={text}
      accessibilityValue={{ min: 0, max: Math.max(total, 0), now: Math.min(Math.max(done, 0), Math.max(total, 0)) }}
      style={{ gap: 8 }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Text style={{ fontSize: 15, color: ink, fontVariant: ["tabular-nums"] }}>{text}</Text>
        <Text style={{ fontSize: 15, color: ink, fontVariant: ["tabular-nums"] }}>{percent}%</Text>
      </View>
      <View
        style={{
          height: 8,
          borderRadius: 4,
          overflow: "hidden",
          backgroundColor: onNavy ? HEADER.track : c.line,
        }}
      >
        <View style={{ width: `${percent}%`, height: "100%", borderRadius: 4, backgroundColor: c.flame }} />
      </View>
    </View>
  );
}
