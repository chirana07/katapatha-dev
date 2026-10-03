import { StatusBar } from "react-native";

/**
 * Light status-bar icons, for a screen whose top edge is navy or otherwise dark
 * (the trip and stop headers, the sign-in hero). React Native keeps a stack of
 * StatusBar declarations, so the style reverts to the root default when this
 * unmounts. React Native 0.87 draws edge to edge on Android, so `barStyle` is the
 * only thing configurable (`translucent` and `backgroundColor` are gone from its
 * types). expo-status-bar is not a dependency of this app; this is the plain
 * React Native component.
 */
export function StatusBarOnDark() {
  return <StatusBar barStyle="light-content" />;
}
