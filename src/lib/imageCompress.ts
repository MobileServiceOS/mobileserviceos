// ─────────────────────────────────────────────────────────────────────
//  Image compression — canvas-based downscale + JPEG re-encode.
//  Pure browser APIs; no library. Cuts a 5–10 MB camera photo to
//  ~200–500 KB at 1600 px wide, which is plenty for field-service
//  invoice photos and keeps uploads viable on weak signals.
//
//  Returns the compressed Blob alongside the resulting dimensions
//  so callers can show a "compressed from X KB to Y KB" preview.
//
//  Falls back to returning the original file untouched when the
//  browser can't decode it (e.g. HEIC on older Safari without a
//  polyfill) — the upload still succeeds, just at original size.
// ─────────────────────────────────────────────────────────────────────

export interface CompressOptions {
  /** Largest dimension in px. The shorter side scales proportionally.
   *  Default 1600. */
  maxDim?: number;
  /** JPEG quality 0..1. Default 0.82 — sharp enough to read tire
   *  sidewalls and damage details, small enough to upload fast. */
  quality?: number;
}

export interface CompressResult {
  blob: Blob;
  width: number;
  height: number;
  originalSize: number;
  compressedSize: number;
}

/** Compute new dimensions that preserve aspect ratio and fit within
 *  maxDim on the largest side. Pure — exported for unit testing. */
export function fitWithin(
  w: number,
  h: number,
  maxDim: number,
): { w: number; h: number } {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { w: 0, h: 0 };
  }
  if (w <= maxDim && h <= maxDim) return { w, h };
  if (w >= h) {
    return { w: maxDim, h: Math.round((h / w) * maxDim) };
  }
  return { w: Math.round((w / h) * maxDim), h: maxDim };
}

/** Decode + downscale + JPEG-reencode an image File. Browser-only. */
export async function compressImage(
  file: File | Blob,
  options: CompressOptions = {},
): Promise<CompressResult> {
  const maxDim = options.maxDim ?? 1600;
  const quality = options.quality ?? 0.82;
  const originalSize = file.size;

  // Decode via createImageBitmap when available (fast, off-thread on
  // most browsers); fall back to HTMLImageElement for older Safari.
  let bitmap: ImageBitmap | HTMLImageElement;
  let srcW: number;
  let srcH: number;
  try {
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(file);
      srcW = bitmap.width;
      srcH = bitmap.height;
    } else {
      bitmap = await loadHtmlImage(file);
      srcW = bitmap.naturalWidth;
      srcH = bitmap.naturalHeight;
    }
  } catch {
    // Decode failed (e.g. unsupported HEIC). Pass through.
    return {
      blob: file,
      width: 0, height: 0,
      originalSize,
      compressedSize: originalSize,
    };
  }

  const { w, h } = fitWithin(srcW, srcH, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { blob: file, width: srcW, height: srcH, originalSize, compressedSize: originalSize };
  }
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);

  // canvas.toBlob is async; wrap in Promise.
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
      'image/jpeg',
      quality,
    );
  });

  // Defensive: if the "compressed" result is bigger than the
  // original (rare for already-small JPEGs), keep the original.
  if (blob.size > originalSize) {
    return { blob: file, width: srcW, height: srcH, originalSize, compressedSize: originalSize };
  }

  return { blob, width: w, height: h, originalSize, compressedSize: blob.size };
}

function loadHtmlImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
