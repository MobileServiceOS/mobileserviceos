// src/lib/logoDataUri.ts
// ═══════════════════════════════════════════════════════════════════
//  Downscale an uploaded logo File to a small PNG data URI (≤maxDim).
//  Stored as brand.logoDataUri so the UI and generated PDFs can render
//  the logo directly — a data URI needs no network/CORS, unlike a
//  Firebase Storage URL (whose uploads have been failing for the live
//  account). The source is a local File (same-origin blob), so the
//  canvas isn't tainted and toDataURL succeeds. Resolves null on any
//  failure (unreadable file, decode error, no canvas context).
// ═══════════════════════════════════════════════════════════════════

export function fileToLogoDataUri(file: File, maxDim = 256): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof FileReader === 'undefined' || typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
          const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
          const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png'));
        } catch { resolve(null); }
      };
      img.src = typeof reader.result === 'string' ? reader.result : '';
    };
    reader.readAsDataURL(file);
  });
}
