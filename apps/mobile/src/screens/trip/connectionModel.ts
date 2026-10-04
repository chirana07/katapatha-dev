import type { ConnectionLabel } from "../../driver/connection-state";

/** How the Connection card shows the verified label: a tone and a glyph, always beside the word. */
export function connectionPill(label: ConnectionLabel): {
  tone: "good" | "warn" | "neutral";
  icon: "wifi" | "wifi-off";
} {
  switch (label) {
    case "Connected":
      return { tone: "good", icon: "wifi" };
    case "Offline":
      return { tone: "warn", icon: "wifi-off" };
    case "Checking":
      return { tone: "neutral", icon: "wifi" };
  }
}

/** The one-line result of "Use this server". */
export function serverSwitchedNote(resolvedUrl: string): string {
  return `Now using ${resolvedUrl}.`;
}

/** The skew line on "This phone": a fact about the clocks, in whole seconds, never a judgement. */
export function clockDifferenceLine(skewMs: number | null): string | null {
  if (skewMs === null) return null;
  return `Clock differs from the server by ${Math.round(Math.abs(skewMs) / 1000)}s`;
}
