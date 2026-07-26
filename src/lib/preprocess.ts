// ---------------------------------------------------------------------------
// Client-side image preprocessing to make tesseract OCR far more accurate.
//
// Screenshots of PSX tables are hostile to OCR: coloured company icons,
// red/green P&L text, faint grey subtitles, and anti-aliased small type. We
// fix that in a <canvas> before OCR:
//   1. upscale small images (bigger glyphs = better recognition)
//   2. convert to greyscale (kills the colour noise entirely)
//   3. stretch contrast so text goes near-black and background near-white
//
// Returns a PNG Blob ready to hand to tesseract.
// ---------------------------------------------------------------------------

export interface PreprocessOptions {
  /** Aim for at least this width in px (upscales small images). Default 2000. */
  targetWidth?: number;
  /** Hard cap on width to avoid huge canvases. Default 3200. */
  maxWidth?: number;
  /** Contrast multiplier around mid-grey. Default 1.6. */
  contrast?: number;
  /** If true, hard threshold to pure black/white. Default false (safer). */
  binarize?: boolean;
  /** Threshold used when binarize is true (0..255). Default 165. */
  threshold?: number;
}

export async function preprocessImage(
  file: Blob,
  opts: PreprocessOptions = {}
): Promise<Blob> {
  const targetWidth = opts.targetWidth ?? 2000;
  const maxWidth = opts.maxWidth ?? 3200;
  const contrast = opts.contrast ?? 1.6;

  const bitmap = await createImageBitmap(file);
  let scale = 1;
  if (bitmap.width < targetWidth) scale = targetWidth / bitmap.width;
  const width = Math.min(maxWidth, Math.round(bitmap.width * scale));
  const height = Math.round(bitmap.height * (width / bitmap.width));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return file;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  const thr = opts.threshold ?? 165;

  for (let i = 0; i < d.length; i += 4) {
    // luma (perceptual greyscale)
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // contrast stretch around mid-grey
    let v = (g - 128) * contrast + 128;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    if (opts.binarize) v = v > thr ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);

  return await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b ?? file), "image/png")
  );
}
