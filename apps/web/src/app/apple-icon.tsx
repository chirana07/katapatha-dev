import { ImageResponse } from "next/og";
import { color } from "@katapatha/tokens/tokens";
import { lockupDataUrl, MARK } from "@/lib/brand-image";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The home-screen icon: the mark on white with a margin, so iOS's rounded mask does not clip a petal. */
export default async function AppleIcon() {
  const src = await lockupDataUrl("light");
  const mark = 132;
  const scale = mark / MARK.size;
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          background: color.surface,
        }}
      >
        <div style={{ display: "flex", width: mark, height: mark, overflow: "hidden", position: "relative" }}>
          <img
            src={src}
            alt=""
            width={MARK.sourceWidth * scale}
            height={MARK.sourceHeight * scale}
            style={{ position: "absolute", left: -MARK.x * scale, top: -MARK.y * scale }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
