import { View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { ICON_PATHS, type IconName } from "./iconPaths";
import { useTheme } from "./theme";

export type { IconName };

/**
 * A small named icon, drawn inline (react-native-svg is already a dependency).
 *
 * Decorative unless given a `label`: colour is never the only carrier of meaning
 * (docs/DESIGN.md), so an icon beside text is hidden from the screen reader and
 * an icon standing alone must say what it is. With no `color` it takes the
 * theme's ink.
 */
export function Icon({
  name,
  size = 20,
  color,
  strokeWidth = 2,
  label,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Makes the icon meaningful to a screen reader. Omit when text sits beside it. */
  label?: string;
}) {
  const { c } = useTheme();
  const stroke = color ?? c.ink;

  return (
    <View
      accessible={!!label}
      accessibilityRole={label ? "image" : undefined}
      accessibilityLabel={label}
      accessibilityElementsHidden={!label}
      importantForAccessibility={label ? "yes" : "no-hide-descendants"}
      style={{ width: size, height: size }}
    >
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICON_PATHS[name].map((shape, index) => {
          switch (shape.t) {
            case "path":
              return (
                <Path
                  key={index}
                  d={shape.d}
                  fill={shape.fill ? stroke : "none"}
                  stroke={shape.fill ? "none" : stroke}
                />
              );
            case "circle":
              return (
                <Circle
                  key={index}
                  cx={shape.cx}
                  cy={shape.cy}
                  r={shape.r}
                  fill={shape.fill ? stroke : "none"}
                  stroke={shape.fill ? "none" : stroke}
                />
              );
            case "rect":
              return (
                <Rect key={index} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} />
              );
          }
        })}
      </Svg>
    </View>
  );
}
