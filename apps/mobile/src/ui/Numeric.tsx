import { Text, type TextProps } from "react-native";
import { useTheme } from "./theme";

/**
 * A number, a clock time or an id.
 *
 * docs/DESIGN.md requires tabular numerals on quantities, clocks and ids: in a
 * list of stops, proportional digits make columns of times ragged and a figure
 * like 118/120 harder to scan on a phone at arm's length on a loading dock.
 */
export function Numeric({ style, ...rest }: TextProps) {
  const { c } = useTheme();
  return <Text {...rest} style={[{ fontVariant: ["tabular-nums"], color: c.ink }, style]} />;
}
