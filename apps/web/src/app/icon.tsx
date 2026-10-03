import { ImageResponse } from "next/og";
import { lockupDataUrl, MARK } from "@/lib/brand-image";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/**
 * The browser-tab icon: the Katapatha mark, cropped out of the supplied
 * lockup. Generated rather than committed so there is one source of artwork.
 */
export default async function Icon() {
  const src = await lockupDataUrl("light");
  const scale = size.width / MARK.size;
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", overflow: "hidden", position: "relative" }}>
        <img
          src={src}
          alt=""
          width={MARK.sourceWidth * scale}
          height={MARK.sourceHeight * scale}
          style={{ position: "absolute", left: -MARK.x * scale, top: -MARK.y * scale }}
        />
      </div>
    ),
    { ...size },
  );
}
