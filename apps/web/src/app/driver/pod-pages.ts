import { FIT_STEPS, byteLabel, fitWithin, fitsPage } from "./image-fit";

/**
 * Turns a photo picked or taken on the phone into one proof-of-delivery page:
 * a JPEG data URL small enough for the API. Browser-only (it draws on a canvas);
 * the sizing maths is in `image-fit.ts`, where it is tested.
 */
export type PageReadResult =
  | { ok: true; dataUrl: string; reducedFrom: number | null }
  | { ok: false; error: string };

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === "function") {
    // `from-image` applies the camera's EXIF rotation, so a portrait receipt is not saved on its side.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("decode"));
    image.src = url;
  });
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

export async function readPodPage(file: File): Promise<PageReadResult> {
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "That file is not a picture. Take a photo of the receipt, or choose an image." };
  }

  try {
    // A small image in a format the API stores can go as it is, untouched.
    if (/^image\/(jpeg|png|webp)$/.test(file.type)) {
      const original = await readAsDataUrl(file);
      if (fitsPage(original)) return { ok: true, dataUrl: original, reducedFrom: null };
    }

    const decoded = await decode(file);
    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return { ok: false, error: "This browser cannot prepare the picture. Try a smaller photo." };
      for (const step of FIT_STEPS) {
        const size = fitWithin(decoded.width, decoded.height, step.maxEdge);
        if (size.width === 0) break;
        canvas.width = size.width;
        canvas.height = size.height;
        context.fillStyle = "white"; // a transparent PNG would otherwise turn black as a JPEG
        context.fillRect(0, 0, size.width, size.height);
        context.drawImage(decoded.source, 0, 0, size.width, size.height);
        const candidate = canvas.toDataURL("image/jpeg", step.quality);
        if (fitsPage(candidate)) return { ok: true, dataUrl: candidate, reducedFrom: file.size };
      }
    } finally {
      decoded.release();
    }
    return {
      ok: false,
      error: `That picture (${byteLabel(file.size)}) is too detailed to send even after shrinking it. Take the photo again from a little further back.`,
    };
  } catch {
    return { ok: false, error: "The picture could not be read. Take the photo again." };
  }
}
