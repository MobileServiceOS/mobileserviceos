import { jsPDF } from 'jspdf';
import type { Job, Settings, Brand } from '@/types';
import { TODAY } from '@/lib/defaults';
import { money, r2, resolvePaymentStatus } from '@/lib/utils';
import { hasProAccess } from '@/lib/planAccess';

// ─────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Map an internal service name to a customer-friendly one. Keeps the
 * invoice from saying "Tire" or "Service" — which look unprofessional —
 * and instead uses descriptive language a real customer would expect on
 * a paid invoice. Falls through to the original name when no mapping.
 */
function customerFriendlyServiceName(raw: string | undefined | null): string {
  if (!raw) return 'Mobile Tire Service';
  const k = raw.trim().toLowerCase();

  // Order matters — more specific keys first.
  const map: Array<[string, string]> = [
    ['tire repair',           'Flat Tire Repair Service'],
    ['flat tire',             'Flat Tire Repair Service'],
    ['tire replacement',      'Mobile Tire Replacement Service'],
    ['tire installation',     'Tire Installation Service'],
    ['tire change',           'Mobile Tire Replacement Service'],
    ['spare',                 'Spare Tire Installation'],
    ['mount',                 'Tire Mount & Balance'],
    ['balance',               'Tire Mount & Balance'],
    ['roadside',              'Emergency Roadside Tire Service'],
    ['emergency',             'Emergency Roadside Tire Service'],
    ['rotation',              'Tire Rotation Service'],
    ['tractor-trailer',       'Commercial Tire Service'],
    ['semi',                  'Commercial Tire Service'],
    ['plug',                  'Flat Tire Repair Service'],
    ['patch',                 'Flat Tire Repair Service'],
    ['tire',                  'Mobile Tire Service'],
    ['service',               'Mobile Tire Service'],
    ['dispatch',              'Mobile Tire Service'],
  ];

  for (const [needle, friendly] of map) {
    if (k.includes(needle)) return friendly;
  }
  return raw;
}

/**
 * Format an ISO timestamp like "May 11, 2026 at 8:42 PM".
 * Used for payment timestamp (#8).
 */
function formatPaymentTimestamp(iso: string | undefined | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const date = d.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const time = d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
    return `${date} at ${time}`;
  } catch {
    return '';
  }
}

/**
 * Format an ISO/yyyy-mm-dd date as "May 11, 2026" for the Completed line.
 */
function formatCompletedDate(s: string | undefined | null): string {
  if (!s) return '';
  try {
    // Handle both 2026-05-11 and full ISO; parse as local to avoid the
    // off-by-one date shift that UTC parsing causes.
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    let d: Date;
    if (m) {
      d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    } else {
      d = new Date(s);
    }
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return s;
  }
}

/**
 * Sanitize a string for use in a filename. Trims, drops special chars,
 * collapses spaces to single underscores. Empty → fallback.
 */
function sanitizeForFilename(s: string | undefined | null, fallback: string): string {
  if (!s) return fallback;
  const out = s
    .trim()
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 40);
  return out || fallback;
}

/**
 * Pre-load a remote logo URL into a PNG data URI that jsPDF.addImage
 * can draw. jsPDF needs raw image bytes (data URI), not a URL.
 *
 * Strategy (in order of reliability):
 *   1. Already a data URI? Return as-is.
 *   2. Load via <Image> with crossOrigin="anonymous", then draw to a
 *      canvas and read back as PNG data URI. This is the canonical
 *      pattern that works with Firebase Storage URLs once the storage
 *      bucket has CORS configured for the app origin (which our app
 *      bucket does — see firebase.json / CORS rules).
 *   3. If <Image> fails (CORS rejected by server, 404, network error),
 *      fall back to fetch() + FileReader. This handles cases where the
 *      server allows fetch but not <img> tainted-canvas reads.
 *   4. All failures return null so the invoice still renders without
 *      a logo rather than blocking the PDF.
 */
async function preloadLogo(url: string | undefined | null): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;

  // Strategy 2: Image() → canvas → toDataURL. Works for Firebase
  // Storage when the bucket emits Access-Control-Allow-Origin.
  const viaImage = await new Promise<string | null>((resolve) => {
    try {
      const img = new Image();
      // crossOrigin MUST be set before src for the request to include
      // CORS headers. Setting it after has no effect.
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        try {
          // Skip 0-dim images (broken upload).
          if (!img.naturalWidth || !img.naturalHeight) {
            resolve(null);
            return;
          }
          const canvas = document.createElement('canvas');
          // Cap canvas size — the logo only renders at ~28mm = ~106px
          // on a 96 DPI PDF, so any source above 512px is wasted bytes.
          const maxDim = 512;
          const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
          canvas.width = Math.round(img.naturalWidth * scale);
          canvas.height = Math.round(img.naturalHeight * scale);
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          // toDataURL throws SecurityError if the canvas is tainted
          // (no CORS) — guarded by the try/catch.
          const dataUri = canvas.toDataURL('image/png');
          resolve(dataUri);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      // 8-second cap — if the image hasn't loaded by then, the invoice
      // ships without a logo rather than hanging the user's tap.
      setTimeout(() => resolve(null), 8000);
      img.src = url;
    } catch {
      resolve(null);
    }
  });

  if (viaImage) return viaImage;

  // Strategy 3: fetch() + FileReader. Some storage backends allow
  // cross-origin fetch but reject <img> tainted reads. The original
  // implementation; kept as a safety net.
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Resolve whether the business is on the Pro plan. Branded invoice
 * features (logo + brand primary color) are reserved for Pro. Core
 * users get a clean, generic invoice with the universal gold default.
 *
 * Delegates to the centralized plan-access module so the invoice gate
 * stays in lockstep with every other Pro check across the app. The
 * resolver handles trialing accounts as Pro automatically — see
 * `resolvePlan` in `src/lib/planAccess.ts` for the full ruleset.
 *
 * Kept as a thin wrapper (rather than calling `hasProAccess` inline
 * everywhere) so existing comments/blame in `generateInvoicePDF`
 * still read sensibly and the local name signals "this is the
 * invoice-side branding gate" semantically.
 */
function isProEntitled(settings: Settings): boolean {
  return hasProAccess(settings);
}

// ─────────────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────────────

export function generateInvoiceNumber(brand: Brand, job: Job): string {
  const slug = (brand.businessName || 'SVC').replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase();
  return slug + '-' + (job.date || '').replace(/-/g, '') + '-' + (job.id || '').slice(-4).toUpperCase();
}

export interface InvoiceResult {
  filename: string;
  invoiceNumber: string;
}

export interface InvoiceOptions {
  /** Optional technician display name, resolved from `job.createdByUid`.
   *  Caller (App.tsx) owns the resolution since it has access to the
   *  members directory. Pass undefined to skip the Technician line. */
  technicianName?: string | null;
}

/**
 * Premium-feel mobile-tire-service invoice generator.
 *
 * Customer-facing — DOES NOT expose internal pricing breakdowns, dispatch
 * fee allocations, or markup structure. The customer sees:
 *   - friendly service name + qty
 *   - tire size + vehicle type (when known)
 *   - service location (when known)
 *   - technician (when known)
 *   - completed date + payment timestamp/method (when paid)
 *   - one big final total
 *   - business-set warranty (when enabled)
 *   - business-set footer text
 *   - review CTA (only when brand.reviewUrl is set)
 *
 * Branding (logo + custom primary color) is GATED to the Pro plan.
 * Core-tier accounts get the same clean layout with the universal
 * gold accent and no logo, so the invoice is still professional —
 * just not white-labeled. This is the headline upgrade hook from
 * Core to Pro on the pricing page.
 *
 * Async because it pre-fetches the brand logo into a base64 data URI
 * before drawing (jsPDF.addImage requires inlined image bytes).
 */
export async function generateInvoicePDF(
  job: Job,
  settings: Settings,
  brand: Brand,
  opts: InvoiceOptions = {},
): Promise<InvoiceResult | null> {
  if (!jsPDF) {
    alert('PDF library not loaded.');
    return null;
  }

  // ── Plan gate ─────────────────────────────────────────────────────
  // Pro accounts get logo + brand color. Core gets the default look.
  const isPro = isProEntitled(settings);

  // ── Inline the logo before drawing (Pro only) ─────────────────────
  // Skip the network round-trip entirely on Core so the invoice
  // generates faster AND the logo never leaks into a non-Pro export.
  const logoDataUri = isPro ? await preloadLogo(brand.logoUrl) : null;

  // ── Document setup ────────────────────────────────────────────────
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 18;

  // Color palette. Hex parsing for the brand primary so PAID badges and
  // accent rule match the customer's actual branding.
  const WHITE: [number, number, number] = [255, 255, 255];
  const NEAR_BLK: [number, number, number] = [20, 20, 20];
  const GRAY: [number, number, number] = [110, 110, 125];
  const LIGHT_GRAY: [number, number, number] = [225, 225, 232];
  const TOTAL_BG_DARK: [number, number, number] = [17, 17, 17];
  const GREEN: [number, number, number] = [34, 178, 86];

  // Pro: use brand.primaryColor. Core: use the universal default so
  // the invoice still looks polished, just not white-labeled.
  const DEFAULT_ACCENT = '#c8a44a';
  const pc = isPro ? (brand.primaryColor || DEFAULT_ACCENT) : DEFAULT_ACCENT;
  const hR = parseInt(pc.slice(1, 3), 16);
  const hG = parseInt(pc.slice(3, 5), 16);
  const hB = parseInt(pc.slice(5, 7), 16);

  // ── Resolve display values ────────────────────────────────────────
  const paymentStatus = resolvePaymentStatus(job);
  const isPaid = paymentStatus === 'Paid';
  const invNum = job.invoiceNumber || generateInvoiceNumber(brand, job);
  const friendlyService = customerFriendlyServiceName(job.service);

  // ═════════════════════════════════════════════════════════════════
  //  HEADER (#2): larger logo, stronger hierarchy, PAID badge
  // ═════════════════════════════════════════════════════════════════
  doc.setFillColor(11, 11, 11);
  doc.rect(0, 0, W, 48, 'F');
  // Accent rule in resolved color (brand on Pro, default on Core)
  doc.setFillColor(hR, hG, hB);
  doc.rect(0, 48, W, 2.5, 'F');

  // Logo (Pro only), bigger than before (28mm vs 24mm). Inlined data
  // URI required. logoDataUri is guaranteed null when isPro=false, so
  // a single nullish check covers both gate and load-failure cases.
  if (logoDataUri) {
    try {
      doc.addImage(logoDataUri, 'PNG', M, 8, 28, 28);
    } catch {
      // ignore — invoice still renders without logo
    }
  }
  const textX = logoDataUri ? M + 34 : M;

  // Business name — larger, stronger typography
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...WHITE);
  doc.text(brand.businessName || 'Mobile Service OS', textX, 20);

  // Business contact line — smaller, dimmer, just one line of context
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(200, 200, 210);
  const infoLine = [brand.phone, brand.email, brand.fullLocationLabel || brand.serviceArea]
    .filter(Boolean).join('  ·  ');
  if (infoLine) doc.text(infoLine, textX, 28);
  if (brand.website) {
    doc.setFontSize(8);
    doc.text(brand.website, textX, 34);
  }

  // "INVOICE" + number in top-right
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(hR, hG, hB);
  doc.text('INVOICE', W - M, 16, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(200, 200, 210);
  doc.text('#' + invNum, W - M, 22, { align: 'right' });

  // Status badge — PAID stamp (#2). Floats under the invoice number.
  if (isPaid) {
    const badgeText = 'PAID ✓';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const padX = 4;
    const tw = doc.getTextWidth(badgeText);
    const bw = tw + padX * 2;
    const bh = 7;
    const bx = W - M - bw;
    const by = 27;
    doc.setFillColor(...GREEN);
    doc.roundedRect(bx, by, bw, bh, 1.5, 1.5, 'F');
    doc.setTextColor(...WHITE);
    doc.text(badgeText, bx + padX, by + 5);
  }

  // ── Body cursor starts below the header band + accent rule ──
  let y = 60;

  // ═════════════════════════════════════════════════════════════════
  //  CUSTOMER + COMPLETED DATE  (#4: "Completed" label)
  // ═════════════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text('BILL TO', M, y);
  doc.text('COMPLETED', 130, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(...NEAR_BLK);
  doc.text(job.customerName || 'Customer', M, y);
  doc.text(formatCompletedDate(job.date) || TODAY(), 130, y);
  y += 5;

  if (job.customerPhone) {
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text(job.customerPhone, M, y);
    y += 4.5;
  }

  // ═════════════════════════════════════════════════════════════════
  //  SERVICE PERFORMED (#3: tire size + vehicle, #6: location, #7: tech)
  // ═════════════════════════════════════════════════════════════════
  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text('SERVICE PERFORMED', M, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...NEAR_BLK);

  // Build the service details rows — only emit each one when known.
  const serviceRows: Array<[string, string]> = [];
  if (job.tireSize) serviceRows.push(['Tire Size', job.tireSize]);
  if (job.vehicleType) serviceRows.push(['Vehicle', job.vehicleType]);
  // Location: prefer fullLocationLabel ("Hollywood, FL") over bare area.
  const locLabel = job.fullLocationLabel || job.area;
  if (locLabel) serviceRows.push(['Service Location', `Completed on-site in ${locLabel}`]);
  // Technician — pulled from the optional opts arg so caller owns
  // member-name resolution. Skip silently when unknown.
  if (opts.technicianName) serviceRows.push(['Technician', opts.technicianName]);

  for (const [label, value] of serviceRows) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...GRAY);
    doc.text(label + ':', M, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...NEAR_BLK);
    doc.text(value, M + 32, y);
    y += 5;
  }

  // ═════════════════════════════════════════════════════════════════
  //  LINE ITEM TABLE (#1: customer-facing only — no internal pricing)
  // ═════════════════════════════════════════════════════════════════
  y += 6;
  // Subtle row header band
  doc.setFillColor(248, 248, 252);
  doc.rect(M, y, W - 2 * M, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text('DESCRIPTION', M + 3, y + 5.5);
  doc.text('QTY', W - M - 30, y + 5.5);
  doc.text('AMOUNT', W - M - 3, y + 5.5, { align: 'right' });
  y += 11;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...NEAR_BLK);

  // One line item per job (#9 customer-friendly name).
  doc.text(friendlyService, M + 3, y + 3);
  doc.setFont('helvetica', 'bold');
  doc.text(String(job.qty || 1), W - M - 30, y + 3);
  doc.text(money(job.revenue || 0), W - M - 3, y + 3, { align: 'right' });
  y += 9;

  // Light separator
  doc.setDrawColor(...LIGHT_GRAY);
  doc.line(M, y, W - M, y);
  y += 8;

  // ═════════════════════════════════════════════════════════════════
  //  TOTALS BOX (#5: large, premium)
  // ═════════════════════════════════════════════════════════════════
  const subtotal = Number(job.revenue || 0);
  const taxRate = Number(settings.invoiceTaxRate || 0) / 100;
  const taxAmt = r2(subtotal * taxRate);
  const total = r2(subtotal + taxAmt);

  // Show subtotal + tax rows ONLY when there's actual tax. Otherwise
  // skip straight to the total — no need to expose internal-looking
  // math when the customer is paying a single round number.
  if (taxRate > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...GRAY);
    doc.text('Subtotal', M + 3, y);
    doc.text(money(subtotal), W - M - 3, y, { align: 'right' });
    y += 6;
    doc.text(`Tax (${settings.invoiceTaxRate}%)`, M + 3, y);
    doc.text(money(taxAmt), W - M - 3, y, { align: 'right' });
    y += 8;
  }

  // Big dark totals box. Filled rectangle with brand-accent left bar.
  const boxH = 22;
  doc.setFillColor(...TOTAL_BG_DARK);
  doc.roundedRect(M, y, W - 2 * M, boxH, 2, 2, 'F');
  // Accent bar on left edge in resolved color
  doc.setFillColor(hR, hG, hB);
  doc.rect(M, y, 2.5, boxH, 'F');

  // Label: "TOTAL PAID" vs "TOTAL DUE" depending on payment state.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(180, 180, 190);
  doc.text(isPaid ? 'TOTAL PAID' : 'TOTAL DUE', M + 7, y + 8);

  // Huge total amount
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...WHITE);
  doc.text(money(total), W - M - 5, y + 15, { align: 'right' });

  y += boxH + 6;

  // ═════════════════════════════════════════════════════════════════
  //  PAYMENT METHOD + TIMESTAMP (#8)
  // ═════════════════════════════════════════════════════════════════
  if (isPaid) {
    const method = job.payment || 'Cash';
    const ts = formatPaymentTimestamp(job.paidAt);
    const line = ts
      ? `Paid via ${method} — ${ts}`
      : `Paid via ${method}`;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...GRAY);
    doc.text(line, M, y);
    y += 6;
  } else if (paymentStatus === 'Pending Payment') {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...GRAY);
    doc.text('Payment due upon receipt.', M, y);
    y += 6;
  }

  // ═════════════════════════════════════════════════════════════════
  //  NOTES (#10) — only when present
  // ═════════════════════════════════════════════════════════════════
  if (job.note && job.note.trim()) {
    y += 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text('NOTES', M, y);
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...NEAR_BLK);
    const noteLines = doc.splitTextToSize(job.note, W - 2 * M);
    doc.text(noteLines, M, y);
    y += noteLines.length * 4.5 + 4;
  }

  // ═════════════════════════════════════════════════════════════════
  //  WARRANTY (#13) — per-business toggle (Pro feature — warranty
  //  branding is a Pro tier perk along with logo and brand color)
  // ═════════════════════════════════════════════════════════════════
  if (isPro && brand.warrantyEnabled && brand.warrantyText && brand.warrantyText.trim()) {
    y += 2;
    doc.setFillColor(248, 248, 252);
    const warrLines = doc.splitTextToSize(brand.warrantyText, W - 2 * M - 6);
    const warrH = warrLines.length * 4 + 6;
    doc.roundedRect(M, y, W - 2 * M, warrH, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text(warrLines, M + 3, y + 4.5);
    y += warrH + 6;
  }

  // ═════════════════════════════════════════════════════════════════
  //  REVIEW CTA (#11) — only when brand.reviewUrl is set
  //  + business-set invoice footer
  //  (#12: collapse aggressively if no content — no wasted whitespace)
  //
  //  Both reviewUrl and invoiceFooter are Pro-tier (white-label) features.
  //  Core sees a single line attribution instead: "Powered by Mobile
  //  Service OS" — this doubles as conversion marketing.
  // ═════════════════════════════════════════════════════════════════
  const reviewUrl = isPro ? (brand.reviewUrl || '').trim() : '';
  const footerText = isPro ? (brand.invoiceFooter || '').trim() : '';

  if (reviewUrl || footerText) {
    // Position the footer block at most ~30mm from the bottom of A4
    // (297mm), but no closer than `y + 8` so it doesn't overlap content
    // when the invoice is short. This balances "anchored to bottom"
    // (premium feel) with "no awkward gap" (#12).
    const targetY = Math.max(y + 8, 257);
    y = targetY;

    // Thin divider above footer
    doc.setDrawColor(...LIGHT_GRAY);
    doc.line(M, y, W - M, y);
    y += 6;

    if (reviewUrl) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...NEAR_BLK);
      doc.text(`Thank you for choosing ${brand.businessName || 'us'}.`, W / 2, y, { align: 'center' });
      y += 5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...GRAY);
      doc.text('We\'d love your feedback — please leave a review:', W / 2, y, { align: 'center' });
      y += 4.5;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(hR, hG, hB);
      // Use jsPDF's link annotation so tapping the URL in a PDF viewer
      // opens the browser. addLink+text is the standard pattern.
      doc.textWithLink(reviewUrl, W / 2, y, { align: 'center', url: reviewUrl });
      y += 5;
    }

    if (footerText) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...GRAY);
      const footLines = doc.splitTextToSize(footerText, W - 2 * M);
      doc.text(footLines, W / 2, y, { align: 'center' });
    }
  } else if (!isPro) {
    // Core-tier attribution footer. Anchored to the bottom of the page
    // so it sits in the same spot regardless of invoice length. Doubles
    // as a passive marketing nudge — every Core invoice the customer
    // receives points back to the platform.
    const attribY = 280;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(170, 170, 180);
    doc.text('Powered by Mobile Service OS', W / 2, attribY, { align: 'center' });
  }

  // ═════════════════════════════════════════════════════════════════
  //  SMART FILENAME (#14)
  //  Format: BusinessName_Invoice_YYYY-MM-DD_CustomerName.pdf
  // ═════════════════════════════════════════════════════════════════
  const bizSlug = sanitizeForFilename(brand.businessName, 'Invoice');
  const dateSlug = (job.date || TODAY()).replace(/[^0-9-]/g, '').slice(0, 10);
  const custSlug = sanitizeForFilename(
    (job.customerName || '').split(/\s+/)[0],  // first name only for brevity
    'Customer',
  );
  const filename = `${bizSlug}_Invoice_${dateSlug}_${custSlug}.pdf`;
  doc.save(filename);
  return { filename, invoiceNumber: invNum };
}
