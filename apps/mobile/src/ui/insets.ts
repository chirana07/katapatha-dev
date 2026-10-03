import { Platform, StatusBar } from "react-native";
import { computeInsets } from "./logic";

/**
 * Top and bottom allowances for the chrome. See `computeInsets` for why these are
 * conservative values and not react-native-safe-area-context measurements.
 */
export function useInsets(): { top: number; bottom: number } {
  return computeInsets(Platform.OS, StatusBar.currentHeight ?? undefined);
}
