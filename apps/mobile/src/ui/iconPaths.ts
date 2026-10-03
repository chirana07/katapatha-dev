/**
 * Drawing data for Icon.tsx, kept free of React so a test can assert every name
 * has a drawing. 24x24 grid; stroked with round caps and joins unless a shape
 * says `fill`.
 */
export type IconShape =
  | { t: "path"; d: string; fill?: boolean }
  | { t: "circle"; cx: number; cy: number; r: number; fill?: boolean }
  | { t: "rect"; x: number; y: number; w: number; h: number; rx: number };

const p = (d: string, fill = false): IconShape => ({ t: "path", d, fill });
const c = (cx: number, cy: number, r: number, fill = false): IconShape => ({ t: "circle", cx, cy, r, fill });

const WIFI_ARCS = [
  p("M2.5 9.2a14 14 0 0 1 19 0"),
  p("M5.6 12.6a9.5 9.5 0 0 1 12.8 0"),
  p("M8.8 16a5 5 0 0 1 6.4 0"),
];

const EYE = p("M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z");

export const ICON_PATHS = {
  check: [p("M5 12.5l4.5 4.5L19 7.5")],
  clock: [c(12, 12, 9), p("M12 7v5l3 2")],
  pin: [p("M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"), c(12, 10, 2.2)],
  clipboard: [{ t: "rect", x: 6, y: 4.5, w: 12, h: 16, rx: 2 }, p("M9.5 4.5h5v2h-5zM9 11h6M9 15h4")],
  play: [p("M7.5 5.2l11 6.8-11 6.8z")],
  warning: [p("M12 4l9 16H3z"), p("M12 10v4M12 17.2v.1")],
  wifi: [...WIFI_ARCS, c(12, 19.4, 1.2, true)],
  "wifi-off": [p("M2.5 9.2a14 14 0 0 1 4-2.6M21.5 9.2a14 14 0 0 0-8-3.9"), p("M5.6 12.6a9.5 9.5 0 0 1 3-1.7M18.4 12.6a9.5 9.5 0 0 0-3-1.7"), p("M8.8 16a5 5 0 0 1 6.4 0"), c(12, 19.4, 1.2, true), p("M3.5 3.5l17 17")],
  swap: [p("M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4")],
  doc: [p("M7 3h7l4 4v14H7z"), p("M14 3v4h4M9.5 13h6M9.5 17h6")],
  phone: [{ t: "rect", x: 7, y: 2.8, w: 10, h: 18.4, rx: 2.2 }, p("M10.8 18h2.4")],
  bulb: [p("M9 18h6M10 21h4"), p("M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z")],
  camera: [p("M3.5 8h3.3l1.7-2.8h7l1.7 2.8h3.3v11.5h-17z"), c(12, 13.5, 3.6)],
  plus: [p("M12 5v14M5 12h14")],
  minus: [p("M5 12h14")],
  retake: [p("M3.5 12a8.5 8.5 0 1 0 2.9-6.4"), p("M3.5 4v5h5")],
  "chevron-right": [p("M9 6l6 6-6 6")],
  "chevron-down": [p("M6 9l6 6 6-6")],
  "arrow-left": [p("M19 12H5M11 6l-6 6 6 6")],
  "arrow-right": [p("M5 12h14M13 6l6 6-6 6")],
  "dots-vertical": [c(12, 5, 1.7, true), c(12, 12, 1.7, true), c(12, 19, 1.7, true)],
  eye: [EYE, c(12, 12, 3)],
  "eye-off": [EYE, c(12, 12, 3), p("M4 4l16 16")],
  truck: [p("M2.5 6h11v10.5h-11zM13.5 9.5h4.2l3.3 3.4v3.6h-7.5"), c(7, 18, 2), c(17, 18, 2)],
  "cloud-off": [p("M7 18.5h10.2a4 4 0 0 0 1.4-7.7A6 6 0 0 0 9.6 7.6M5.4 9.9A4.7 4.7 0 0 0 7 18.5"), p("M3.5 3.5l17 17")],
  refresh: [p("M20 11a8 8 0 0 0-14.3-3.6M4.3 4.5v4h4"), p("M4 13a8 8 0 0 0 14.3 3.6M19.7 19.5v-4h-4")],
  x: [p("M6 6l12 12M18 6L6 18")],
  info: [c(12, 12, 9), p("M12 11v5.2M12 7.9v.1")],
  user: [c(12, 8, 3.6), p("M4.5 20a7.5 7.5 0 0 1 15 0")],
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof ICON_PATHS;

export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];
