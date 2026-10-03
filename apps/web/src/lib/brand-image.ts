import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The brand files as data URLs, for `ImageResponse` (the icon and share-image
 * routes). They are read from `public/logo`, so the favicon, the touch icon and
 * the social card are cut from the same artwork the pages use and cannot drift
 * from it.
 *
 * `light` carries the navy wordmark (for light surfaces), `dark` the white one
 * (for navy). The names follow the surface the wordmark is read on, which is
 * the reverse of what DESIGN.md's prose says; the files are what render.
 */
const FILES = {
  light: "katapatha-lockup-light.png",
  dark: "katapatha-lockup-dark.png",
} as const;

export async function lockupDataUrl(variant: keyof typeof FILES): Promise<string> {
  const bytes = await readFile(join(process.cwd(), "public", "logo", FILES[variant]));
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

/**
 * Where the four-petal mark sits inside `katapatha-lockup-light.png` (1600 x
 * 417), measured from the artwork: the coloured pixels span x 11-405 and y
 * 11-405. The crop leaves a few px of margin. The dark lockup is a different
 * size and its mark is offset, so these numbers belong to the light file only.
 * Cropping is what turns the lockup into a square icon without redrawing it.
 */
export const MARK = { x: 6, y: 6, size: 405, sourceWidth: 1600, sourceHeight: 417 } as const;
