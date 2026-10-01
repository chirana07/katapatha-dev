// Metro in a pnpm workspace.
//
// The workspace packages (@katapatha/tokens, /core, /api-client, /contracts)
// are symlinks into ../../packages/* and expose raw .ts source via their
// "exports" map -- nothing is pre-built. Metro's default watchFolders is the
// project root only, so without this it cannot see, watch or transform any of
// them, and `import { color } from "@katapatha/tokens/tokens"` fails to
// resolve. This is a requirement for the app to bundle at all, not a tuning
// knob.
//
// nodeModulesPaths is the pnpm half: dependencies are hoisted to the workspace
// root rather than nested, so resolution has to look in both places.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// NOT disableHierarchicalLookup. It is tempting -- it stops one package being
// resolved through two paths -- but pnpm DEPENDS on hierarchical lookup: every
// package's own dependencies live in a nested node_modules inside the store
// (node_modules/.pnpm/<pkg>@<hash>/node_modules/), and turning the walk-up off
// makes expo-router unable to resolve its own peers.

// react-native@0.87.1 no longer PUBLISHES rn-get-polyfills.js -- it is absent from
// the `files` list in its package.json -- but @expo/metro-config@57.0.12 (the
// version expo@57.0.26 pins, and the latest 57.0.x) still does
// `require(<react-native>/rn-get-polyfills)` in its getPolyfills. So bundling
// fails on Expo's own pinned combination, before any app code is reached.
//
// @react-native/js-polyfills is where those polyfills actually live now, and it
// exports the identical "() => string[]" that Expo is calling. Wiring it directly
// is the whole fix. Remove this once @expo/metro-config stops looking for the old
// shim.
config.serializer.getPolyfills = require("@react-native/js-polyfills");

module.exports = config;
