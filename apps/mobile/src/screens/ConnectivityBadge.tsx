import { useConnectivity } from "@/state/connectivity";
import { ConnectivityChip } from "@/ui/ConnectivityChip";

/**
 * The header's connectivity chip, fed by the verified /health label.
 *
 * The wording is exactly Checking / Connected / Offline, which DESIGN.md
 * restricts it to, and it comes from a verified /health call rather than a radio
 * state. The chip itself (dot, word, wifi glyph, accessibility label) lives in
 * src/ui/ConnectivityChip.tsx.
 *
 * The unsent count no longer rides here: the Trip screen's "Unsent records"
 * control carries it, where it can be acted on.
 */
export function ConnectivityBadge() {
  const { label } = useConnectivity();
  return <ConnectivityChip label={label} />;
}
