import type { ExpoConfig } from "expo/config";

/**
 * Dynamic config, replacing the former app.json.
 *
 * The default base URL is the Prism mock, not the real API. Every driver and
 * sync endpoint in apps/api still returns 501 (routes/{driver,stops,sync}.ts),
 * so the mock on :4010 is the only base URL where this app is demoable. Note
 * the mock serves paths at the ROOT -- there is no /v1 prefix on it.
 *
 * Override per environment:
 *   KATAPATHA_API_BASE_URL=http://192.168.1.20:4010      mock, physical device
 *   KATAPATHA_API_BASE_URL=http://192.168.1.20:3001/v1   real API
 *
 * A driver can also override it at runtime from the Connection screen, which
 * writes meta.base_url_override in SQLite; resolveBaseUrl() prefers that over
 * this value, because a base URL sometimes has to change on a handset during a
 * demo with no rebuild available.
 */
const DEFAULT_API_BASE_URL = "http://localhost:4010";

const config: ExpoConfig = {
  name: "Katapatha Driver",
  slug: "katapatha-driver",
  scheme: "katapatha",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
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
