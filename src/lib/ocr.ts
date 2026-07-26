// ---------------------------------------------------------------------------
// OCR helper (runs in the BROWSER via tesseract.js).
//
// Uses the worker API so we can tune the engine for each kind of image, and
// runs client-side preprocessing (greyscale + contrast + upscale) first, which
// is the single biggest accuracy win on PSX screenshots. Text is still shown
// in an editable table afterwards, and symbols are fuzzy-snapped to a known
// universe (see symbols.ts) so mis-read tickers get corrected automatically.
// ---------------------------------------------------------------------------

import { createWorker, OEM, PSM } from "tesseract.js";
import { preprocessImage, type PreprocessOptions } from "./preprocess";

export interface OcrProgress {
  status: string;
  progress: number; // 0..1
}

export type OcrKind = "table" | "list";

export interface OcrOptions {
  /** "table" = holdings grid; "list" = model portfolio legend. */
  kind?: OcrKind;
  /** Skip preprocessing (debug). */
  raw?: boolean;
  preprocess?: PreprocessOptions;
  onProgress?: (p: OcrProgress) => void;
}

/**
 * Run OCR over an image and return the raw recognised text.
 */
export async function ocrImage(file: File | Blob, options: OcrOptions = {}): Promise<string> {
  const { kind = "table", raw = false, onProgress } = options;

  const input = raw ? file : await preprocessImage(file, options.preprocess);

  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    logger: (m: { status: string; progress: number }) =>
      onProgress?.({ status: m.status, progress: m.progress ?? 0 }),
  });

  try {
    // PSM.SINGLE_BLOCK reads a uniform block line-by-line (good for the model
    // legend). PSM.SPARSE_TEXT finds text in arbitrary order (better for a wide
    // table with lots of whitespace between columns).
    await worker.setParameters({
      tessedit_pageseg_mode: kind === "table" ? PSM.SPARSE_TEXT : PSM.SINGLE_BLOCK,
      preserve_interword_spaces: "1",
    });
    const { data } = await worker.recognize(input);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
