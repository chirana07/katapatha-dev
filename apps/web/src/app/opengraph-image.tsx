import { ImageResponse } from "next/og";
import { color } from "@katapatha/tokens/tokens";
import { lockupDataUrl } from "@/lib/brand-image";

export const alt = "Katapatha: one shared truth for every delivery";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The card shown when a link to Katapatha is shared. Built from the token
 * palette and the supplied white-wordmark lockup; it makes no product claim
 * beyond the landing page's own headline.
 */
export default async function OpengraphImage() {
  const logo = await lockupDataUrl("dark");
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: 72,
          background: color.navy,
          color: "white",
        }}
      >
        <img src={logo} alt="" width={320} height={82} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 28, letterSpacing: 6, color: color.flame, textTransform: "uppercase" }}>
            Waypoint delivery operations
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 20, fontSize: 88, fontWeight: 700, lineHeight: 1.05 }}>
            <span>One shared truth</span>
            <span style={{ color: color.flame }}>for every delivery.</span>
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 28, opacity: 0.75 }}>
          Plan, load, deliver and receive from one connected record.
        </div>
      </div>
    ),
    { ...size },
  );
}
