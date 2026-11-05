/** Checks an image in the browser and shrinks very large ones, to give quick feedback and save data. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_EDGE = 2048;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const ACCEPT_ATTRIBUTE = "image/jpeg,image/png,image/webp";

export class ImageProblem extends Error {}

export function checkImageFile(file: Blob): void {
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new ImageProblem("Use a JPG, PNG or WEBP image.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ImageProblem("That image is over 15 MB. Use a smaller one.");
  }
}

export function scaledSize(width: number, height: number): { width: number; height: number } | null {
  const longest = Math.max(width, height);
  if (longest <= MAX_EDGE) return null;
  const scale = MAX_EDGE / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Returns the image to send. A screenshot that's already small enough is left untouched. */
export async function prepareImage(file: Blob): Promise<Blob> {
  checkImageFile(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageProblem("This image couldn't be read. It may be damaged.");
  }
  try {
    const size = scaledSize(bitmap.width, bitmap.height);
    if (!size) return file;
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new ImageProblem("This image couldn't be read."))),
        "image/jpeg",
        0.92,
      );
    });
  } finally {
    bitmap.close();
  }
}
