/**
 * WCAG 2.x contrast, pure. Used by ui.test.ts to assert that the token pairs the
 * primitives actually draw meet 4.5:1 in both schemes.
 */

export type Rgba = { r: number; g: number; b: number; a: number };

export function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)$/i.exec(value);
  if (rgba) {
    return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  }
  throw new Error(`Unsupported colour: ${value}`);
}

/** `top` painted over an opaque `bottom`. */
export function compositeOver(top: string, bottom: string): Rgba {
  const t = parseColor(top);
  const b = parseColor(bottom);
  const mix = (x: number, y: number) => Math.round(x * t.a + y * (1 - t.a));
  return { r: mix(t.r, b.r), g: mix(t.g, b.g), b: mix(t.b, b.b), a: 1 };
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast of `fg` on `bg` (either may be translucent; `bg` is flattened onto `under`, default white). */
export function contrastRatio(fg: string, bg: string, under = "#FFFFFF"): number {
  const flatBg = compositeOver(bg, under);
  const flatBgHex = `#${[flatBg.r, flatBg.g, flatBg.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  const l1 = luminance(compositeOver(fg, flatBgHex));
  const l2 = luminance(flatBg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
