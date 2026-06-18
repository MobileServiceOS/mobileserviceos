// src/lib/shareFile.ts
// ───────────────────────────────────────────────────────────────────
//  Share a generated PDF as a real file.
//
//  An `sms:` link can only carry text — it can't attach a PDF. On iOS /
//  Android the native share sheet (navigator.share with `files`) CAN, so
//  the operator can send the quote/invoice PDF through Messages, Mail,
//  WhatsApp, etc. with the document attached. Desktop and unsupported
//  browsers fall back to downloading the PDF + opening the SMS composer
//  with the text body.
// ───────────────────────────────────────────────────────────────────

/** True when the platform can share THIS file via the native share sheet.
 *  Pure + injectable so it's unit-testable. (navigator.share / canShare
 *  aren't in every lib target, so they're probed structurally.) */
export function canShareFiles(nav: Navigator | undefined, file: File): boolean {
  if (!nav) return false;
  const share = (nav as { share?: unknown }).share;
  const canShare = (nav as { canShare?: (data?: ShareData) => boolean }).canShare;
  return typeof share === 'function' && typeof canShare === 'function' && canShare({ files: [file] });
}

export interface SharePdfArgs {
  blob: Blob;
  filename: string;
  /** Message body — included in the share sheet, and used for the SMS
   *  fallback. */
  text: string;
  title?: string;
  /** Digits-only phone for the SMS fallback (optional). */
  phone?: string;
}

export type SharePdfResult = 'shared' | 'downloaded' | 'cancelled';

/**
 * Share the PDF as a file via the native share sheet; on platforms that
 * can't share files, download it and open the SMS composer with `text`.
 * Returns how it was delivered (for the caller's toast).
 */
export async function shareOrDownloadPdf({ blob, filename, text, title, phone }: SharePdfArgs): Promise<SharePdfResult> {
  const file = new File([blob], filename, { type: 'application/pdf' });

  if (typeof navigator !== 'undefined' && canShareFiles(navigator, file)) {
    try {
      await navigator.share({ files: [file], text, title: title || filename });
      return 'shared';
    } catch (e) {
      // User dismissed the share sheet — don't also download behind their back.
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // Any other share failure → fall through to the download path.
    }
  }

  if (typeof document !== 'undefined') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  if (typeof window !== 'undefined') {
    const body = encodeURIComponent(text);
    window.open(phone ? `sms:${phone}?body=${body}` : `sms:?body=${body}`);
  }
  return 'downloaded';
}
