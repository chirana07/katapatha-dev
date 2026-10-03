import { useMemo } from "react";
import { useColorScheme } from "react-native";
import { schemeFromSystem, themeFor, type Theme } from "./tokens";

export { themeFor, schemeFromSystem };
export type { Theme };

/**
 * The palette for the phone's current colour scheme.
 *
 * Night is the system setting and nothing else (docs/DESIGN.md "Night theme";
 * app.config.ts `userInterfaceStyle: "automatic"`): the driver does not pick a
 * palette in-app. A null scheme (React Native reports null before it knows) is
 * light. The result is referentially stable per scheme, so it is safe in
 * dependency arrays.
 */
export function useTheme(): Theme {
  const system = useColorScheme();
  const scheme = schemeFromSystem(system);
  return useMemo(() => themeFor(scheme), [scheme]);
}
