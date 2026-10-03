import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { MAX_PHOTO_BYTES, dataUrlBytes } from "./size";

/**
 * One page's photo, as a JPEG data URL. The Receipt step calls this once per page
 * (a receipt can have several sheets).
 *
 * expo-image-picker's camera rather than expo-camera: the OS camera UI removes a
 * viewfinder screen, a preview-and-retake flow and a permissions edge case, none
 * of which is this product.
 *
 * The resize is not optional. A raw 12MP capture is 1-2 MB of base64, which would
 * travel in a JSON body and sit in SQLite until the batch drained. At 1280px wide
 * and quality 0.5 the same photo is 120-250 KB and still clearly shows a pallet,
 * a door or a damaged carton -- which is what the photo is for.
 */

const TARGET_WIDTH = 1280;
const COMPRESS = 0.5;

export type PhotoResult =
  | {
      kind: "ok";
      dataUrl: string;
      /** Device clock (ISO) the moment the camera handed the photo back, before it was resized. */
      capturedAt: string;
    }
  | { kind: "cancelled" }
  | { kind: "denied" }
  | { kind: "too-large" }
  | { kind: "failed"; message: string };

export async function capturePhoto(): Promise<PhotoResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return { kind: "denied" };

  const captured = await ImagePicker.launchCameraAsync({
    quality: 0.6,
    // The driver photographs the goods, not themselves, and editing would only
    // add a step on a phone held one-handed.
    allowsEditing: false,
    cameraType: ImagePicker.CameraType.back,
  });

  if (captured.canceled || captured.assets.length === 0) return { kind: "cancelled" };
  // The device clock when the photo was taken. Read before the resize, which can
  // take a second on a slow phone, so the page is not stamped after the fact.
  const capturedAt = new Date().toISOString();

  try {
    const context = ImageManipulator.manipulate(captured.assets[0].uri).resize({
      width: TARGET_WIDTH,
    });
    const image = await context.renderAsync();
    const saved = await image.saveAsync({
      format: SaveFormat.JPEG,
      compress: COMPRESS,
      base64: true,
    });

    if (!saved.base64) {
      return { kind: "failed", message: "The photo could not be prepared for sending." };
    }

    const dataUrl = `data:image/jpeg;base64,${saved.base64}`;
    if (dataUrlBytes(dataUrl) > MAX_PHOTO_BYTES) return { kind: "too-large" };

    return { kind: "ok", dataUrl, capturedAt };
  } catch (error) {
    return {
      kind: "failed",
      message:
        error instanceof Error && error.message
          ? "The photo could not be prepared for sending. Try again."
          : "The photo could not be prepared for sending.",
    };
  }
}
