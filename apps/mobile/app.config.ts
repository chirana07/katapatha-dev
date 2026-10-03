import type { ExpoConfig } from "expo/config";

/**
 * Dynamic config, replacing the former app.json.
 *
 * The default base URL is the real API (apps/api, :3001, mounted under /v1).
 * `localhost` on a phone is the phone, so a physical device needs the machine's
 * LAN address, and the API must bind to it (HOST=0.0.0.0; docs/RUNNING.md).
 *
 * Override per environment:
 *   KATAPATHA_API_BASE_URL=http://192.168.1.20:3001/v1   real API, physical device
 *   KATAPATHA_API_BASE_URL=http://192.168.1.20:4010      Prism mock (paths at the root, no /v1)
 *
 * A driver can also override it at runtime from the Connection screen, which
 * writes meta.base_url_override in SQLite; resolveBaseUrl() prefers that over
 * this value, because a base URL sometimes has to change on a handset during a
 * demo with no rebuild available.
 */
const DEFAULT_API_BASE_URL = "http://localhost:3001/v1";

const config: ExpoConfig = {
  name: "Katapatha Driver",
  slug: "katapatha-driver",
  scheme: "katapatha",
  version: "0.1.0",
  orientation: "portrait",
  // "automatic": the system colour scheme decides, and there is no in-app switch.
  // docs/DESIGN.md "Night theme": the driver's palette has a night rendering because
  // a predawn run starts at 03:30 in a dark cab and a full-brightness white screen
  // there is a safety problem. This app is the driver's only (dispatcher, loader and
  // store never see it), so it follows the phone's setting, as the driver set it.
  userInterfaceStyle: "automatic",
  // Android only, per docs/ARCHITECTURE.md: one EAS-built APK, no app store.
  android: { package: "lk.waypoint.katapatha.driver" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-image-picker",
      {
        cameraPermission:
          "Katapatha uses the camera to photograph a delivery as proof of delivery.",
        photosPermission:
          "Katapatha attaches a photo to a delivery as proof of delivery.",
        // Photos only. Without this the plugin adds RECORD_AUDIO to the manifest.
        microphonePermission: false,
      },
    ],
    [
      // Foreground position only, and only after the driver turns sharing on
      // (src/position). No background location, no foreground service, no
      // motion activity. The "always" iOS keys are omitted (false) so nothing
      // in the build can even ask for them.
      "expo-location",
      {
        locationWhenInUsePermission:
          "Katapatha shares this phone's last position with dispatch while the app is open, if you turn it on.",
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        motionUsagePermission: false,
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: false,
        isAndroidMotionActivityEnabled: false,
        isIosBackgroundLocationEnabled: false,
      },
    ],
  ],
  extra: {
    // The router tree lives at src/app so CODEOWNERS' /apps/mobile/src/app/
    // rule applies. metro-config infers this, but stating it removes the
    // inference.
    router: { root: "src/app" },
    apiBaseUrl: process.env.KATAPATHA_API_BASE_URL ?? DEFAULT_API_BASE_URL,
  },
};

export default config;
