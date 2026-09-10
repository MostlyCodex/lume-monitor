import {
  BACKGROUND_MAX_BYTES,
  BACKGROUND_MAX_PIXELS,
  BACKGROUND_MAX_LENGTH,
} from "../domain/layout";

export async function prepareBackground(file: File): Promise<string> {
  if (!file.size) throw new Error("图片为空，请重新选择 JPG、PNG 或 WebP 图片。");
  if (file.size > BACKGROUND_MAX_BYTES) throw new Error("图片超过 10 MB，请选择较小的图片。");
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const matches = (bytes: number[], offset = 0) =>
    bytes.every((byte, index) => header[offset + index] === byte);
  const mime = matches([0xff, 0xd8, 0xff])
    ? "image/jpeg"
    : matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      ? "image/png"
      : matches([0x52, 0x49, 0x46, 0x46]) && matches([0x57, 0x45, 0x42, 0x50], 8)
        ? "image/webp"
        : "";
  if (!mime) throw new Error("不支持此格式，请选择 JPG、PNG 或 WebP 图片。");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("无法读取图片"));
    reader.onerror = () => reject(new Error("无法读取图片，请重新选择。"));
    reader.readAsDataURL(file.slice(0, file.size, mime));
  });
  const image = new Image();
  image.src = data;
  try {
    await image.decode();
  } catch {
    throw new Error("图片无法解码，请选择完整的 JPG、PNG 或 WebP 图片。");
  }
  if (image.naturalWidth * image.naturalHeight > BACKGROUND_MAX_PIXELS) {
    throw new Error("图片超过 2400 万像素，请先缩小尺寸后重试。");
  }
  const canvas = document.createElement("canvas");
  try {
    for (const [edge, quality] of [
      [1920, 0.82],
      [1600, 0.75],
      [1280, 0.7],
    ]) {
      const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) break;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL("image/webp", quality);
      if (result.startsWith("data:image/") && result.length <= BACKGROUND_MAX_LENGTH) return result;
    }
  } finally {
    canvas.width = canvas.height = 0;
  }
  throw new Error("图片压缩后仍过大，请选择尺寸更小或细节更少的图片。");
}
