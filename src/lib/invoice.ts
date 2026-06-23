import { jsPDF } from 'jspdf';
import type { Job, Settings, Brand, JobLineItem } from '@/types';
import { TODAY } from '@/lib/defaults';
import { money, r2, resolvePaymentStatus, realCustomerName } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────
//  Wheel Rush invoice / estimate generator.
//
//  Matches the operator's branded template: orange accent + navy bars +
//  logo, a contact line, PREPARED FOR / VEHICLE / TIRE SIZE / SERVICE TYPE
//  block, an optional itemized line-item table, a TOTAL DUE bar, notes,
//  and a navy footer.
//
//  Two axes, set via InvoiceOptions:
//    • mode:      'invoice' → INVOICE / 'quote' → ESTIMATE (+ Valid Until)
//    • breakdown: 'itemized' (Type B — lists job.lineItems) /
//                 'total'    (Type A — one price, no breakdown)
//  Default breakdown: itemized when the job has line items, else total.
//
//  Customer-facing only — internal cost fields (tireCost etc.) are never
//  shown; the breakdown comes from operator-entered job.lineItems.
// ─────────────────────────────────────────────────────────────────────

/**
 * Format an ISO/yyyy-mm-dd date as "June 23, 2026".
 */
function formatCompletedDate(s: string | undefined | null): string {
  if (!s) return '';
  try {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    let d: Date;
    if (m) {
      d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    } else {
      d = new Date(s);
    }
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return s;
  }
}

/** "Valid Until" date = the job date + N days, formatted like the header. */
function addDaysLabel(dateStr: string | undefined | null, days: number): string {
  const base = dateStr && /^\d{4}-\d{2}-\d{2}/.test(dateStr) ? dateStr.slice(0, 10) : TODAY();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(base);
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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
 */
async function preloadLogo(url: string | undefined | null): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;

  const viaImage = await new Promise<string | null>((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        try {
          if (!img.naturalWidth || !img.naturalHeight) { resolve(null); return; }
          const canvas = document.createElement('canvas');
          const maxDim = 512;
          const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
          canvas.width = Math.round(img.naturalWidth * scale);
          canvas.height = Math.round(img.naturalHeight * scale);
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      setTimeout(() => resolve(null), 8000);
      img.src = url;
    } catch {
      resolve(null);
    }
  });
  if (viaImage) return viaImage;

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

// ─────────────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────────────

/** Document number like "WR-2026-0623" — business initials + year + MMDD. */
export function buildDocNumber(brand: Brand, job: Job): string {
  const words = (brand.businessName || '').trim().split(/\s+/).filter(Boolean);
  const initials = (words.map((w) => w[0]).join('').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase()) || 'WR';
  const d = job.date && /^\d{4}-\d{2}-\d{2}/.test(job.date) ? job.date : TODAY();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  const ymd = m ? `${m[1]}-${m[2]}${m[3]}` : '';
  return ymd ? `${initials}-${ymd}` : initials;
}

/** Normalize operator-entered line items: trim, coerce numbers, drop empties. */
export function normalizeLineItems(job: Job): JobLineItem[] {
  const raw = Array.isArray(job.lineItems) ? job.lineItems : [];
  return raw
    .map((li) => ({
      description: String(li?.description ?? '').trim(),
      qty: Math.max(0, Number(li?.qty) || 0),
      unitPrice: Math.max(0, Number(li?.unitPrice) || 0),
    }))
    .filter((li) => li.description && (li.qty > 0 || li.unitPrice > 0));
}

/** Sum of qty × unitPrice across line items, rounded to cents. */
export function lineItemsTotal(items: ReadonlyArray<JobLineItem>): number {
  return r2(items.reduce((s, li) => s + (Number(li.qty) || 0) * (Number(li.unitPrice) || 0), 0));
}

/** The tagline drawn under the business name. Pro white-label touch. */
export function invoiceTaglineFor(brand: Brand, isPro: boolean): string {
  return isPro ? (brand.tagline || '').trim() : '';
}

export interface InvoiceResult {
  filename: string;
  invoiceNumber: string;
}

export interface InvoiceOptions {
  /** Optional technician display name (reserved; not shown on this layout). */
  technicianName?: string | null;
  /** 'invoice' (default) → INVOICE; 'quote' → ESTIMATE with a Valid Until. */
  mode?: 'invoice' | 'quote';
  /** 'itemized' (Type B) lists job.lineItems; 'total' (Type A) shows one
   *  price. Default: itemized when the job has line items, else total. */
  breakdown?: 'total' | 'itemized';
}

type RGB = [number, number, number];

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

  const isQuote = opts.mode === 'quote';
  const items = normalizeLineItems(job);
  const breakdown = opts.breakdown ?? (items.length ? 'itemized' : 'total');
  const itemized = breakdown === 'itemized' && items.length > 0;

  const isPaid = !isQuote && resolvePaymentStatus(job) === 'Paid';
  const logoDataUri = await preloadLogo(brand.logoUrl);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 18;

  // Palette — orange accent + navy bars, per the Wheel Rush sample.
  const ORANGE: RGB = [242, 106, 33];
  const NAVY: RGB = [22, 38, 63];
  const WHITE: RGB = [255, 255, 255];
  const INK: RGB = [26, 26, 26];
  const GRAY: RGB = [110, 110, 125];
  const ZEBRA: RGB = [244, 245, 248];
  const RULE: RGB = [222, 224, 230];
  const FOOT_SUB: RGB = [196, 202, 212];

  // ── Header: logo (left) + title + meta (right) ───────────────────────
  if (logoDataUri) {
    try {
      const props = doc.getImageProperties(logoDataUri);
      const ratio = props.width && props.height ? props.width / props.height : 2;
      const maxW = 46;
      const maxH = 27;
      let w = maxW;
      let h = w / ratio;
      if (h > maxH) { h = maxH; w = h * ratio; }
      doc.addImage(logoDataUri, 'PNG', M, 12, w, h);
    } catch { /* render without logo */ }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...NAVY);
    doc.text(brand.businessName || 'Mobile Service OS', M, 26);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(...ORANGE);
  doc.text(isQuote ? 'ESTIMATE' : 'INVOICE', W - M, 26, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GRAY);
  let metaY = 34;
  doc.text(`No.  ${buildDocNumber(brand, job)}`, W - M, metaY, { align: 'right' });
  metaY += 5;
  doc.text(`Date:  ${formatCompletedDate(job.date) || formatCompletedDate(TODAY())}`, W - M, metaY, { align: 'right' });
  if (isQuote) {
    metaY += 5;
    doc.text(`Valid Until:  ${addDaysLabel(job.date, 30)}`, W - M, metaY, { align: 'right' });
  }

  // Orange rule under the header.
  doc.setFillColor(...ORANGE);
  doc.rect(0, 48, W, 1.6, 'F');

  // Contact line, centered.
  const region = (brand.serviceArea || '').trim() || 'Broward and Miami Dade';
  const contact = [(brand.phone || '').trim(), (brand.website || '').trim(), '24/7 Mobile Service', region].filter(Boolean);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text(contact.join('     •     '), W / 2, 57, { align: 'center' });

  // ── Info block ───────────────────────────────────────────────────────
  const colR = 112;
  const label = (x: number, yy: number, t: string) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...ORANGE);
    doc.text(t, x, yy);
  };
  const value = (x: number, yy: number, t: string) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK);
    doc.text(t, x, yy);
  };
  const underline = (x: number, yy: number, w: number) => {
    doc.setDrawColor(...RULE); doc.line(x, yy, x + w, yy);
  };

  let y = 70;
  const fieldW = W - M - colR;
  // Left: PREPARED FOR; Right: TIRE SIZE
  label(M, y, 'PREPARED FOR');
  label(colR, y, 'TIRE SIZE');
  const custName = realCustomerName(job.customerName);
  if (custName) value(M, y + 5.5, custName); else underline(M, y + 4.5, fieldW);
  if ((job.tireSize || '').trim()) value(colR, y + 5.5, job.tireSize.trim()); else underline(colR, y + 4.5, fieldW);
  y += 16;
  // Left: VEHICLE; Right: SERVICE TYPE (wraps)
  const vehicle = (job.vehicleMakeModel || job.vehicleType || '').trim();
  label(M, y, 'VEHICLE');
  label(colR, y, 'SERVICE TYPE');
  if (vehicle) value(M, y + 5.5, vehicle); else underline(M, y + 4.5, fieldW);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK);
  const svcLines = doc.splitTextToSize((job.service || 'Tire service').trim(), fieldW);
  doc.text(svcLines, colR, y + 5.5);
  y += 16 + Math.max(0, (svcLines.length - 1) * 5);
  y = Math.max(y, 104);

  // ── Totals math (tax included unless a rate is set) ──────────────────
  const subtotal = itemized ? lineItemsTotal(items) : Number(job.revenue || 0);
  const taxRate = Number(settings.invoiceTaxRate || 0) / 100;
  const taxAmt = r2(subtotal * taxRate);
  const total = r2(subtotal + taxAmt);

  const amtR = W - M - 3;
  const qtyR = 122;
  const unitR = 154;
  const descX = M + 3;

  // ── Itemized table (Type B) ──────────────────────────────────────────
  if (itemized) {
    doc.setFillColor(...NAVY);
    doc.rect(M, y, W - 2 * M, 9, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...WHITE);
    doc.text('DESCRIPTION', descX, y + 6);
    doc.text('QTY', qtyR, y + 6, { align: 'right' });
    doc.text('UNIT PRICE', unitR, y + 6, { align: 'right' });
    doc.text('AMOUNT', amtR, y + 6, { align: 'right' });
    y += 9;

    items.forEach((li, i) => {
      const descLines = doc.splitTextToSize(li.description, qtyR - descX - 8);
      const rowH = Math.max(11, descLines.length * 5 + 5);
      if (i % 2 === 1) { doc.setFillColor(...ZEBRA); doc.rect(M, y, W - 2 * M, rowH, 'F'); }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...INK);
      doc.text(descLines, descX, y + 7);
      doc.text(String(li.qty), qtyR, y + 7, { align: 'right' });
      doc.text(money(li.unitPrice), unitR, y + 7, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.text(money(r2(li.qty * li.unitPrice)), amtR, y + 7, { align: 'right' });
      y += rowH;
    });

    y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...GRAY);
    doc.text('Subtotal', unitR, y, { align: 'right' });
    doc.setTextColor(...INK);
    doc.text(money(subtotal), amtR, y, { align: 'right' });
    y += 6;
    doc.setTextColor(...GRAY);
    doc.text('Tax', unitR, y, { align: 'right' });
    doc.text(taxRate > 0 ? money(taxAmt) : 'Included', amtR, y, { align: 'right' });
    y += 8;
  } else {
    y += 6;
  }

  // ── TOTAL DUE bar ────────────────────────────────────────────────────
  const barX = itemized ? 110 : M;
  const barW = W - M - barX;
  const barH = 13;
  doc.setFillColor(...NAVY);
  doc.rect(barX, y, barW, barH, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...ORANGE);
  doc.text(isPaid ? 'TOTAL PAID' : 'TOTAL DUE', barX + 5, y + 8.6);
  doc.setFontSize(15); doc.setTextColor(...WHITE);
  doc.text(money(total), W - M - 4, y + 9, { align: 'right' });
  y += barH + 11;

  // ── NOTES ────────────────────────────────────────────────────────────
  const notes: string[] = [];
  if ((job.note || '').trim()) notes.push(job.note.trim());
  if (isQuote) notes.push('Estimate valid 30 days from the date above. Final price confirmed on site before any work begins.');
  notes.push(`24/7 mobile tire service across ${region}. We bring the tire shop to you.`);

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...ORANGE);
  doc.text('NOTES', M, y);
  y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GRAY);
  for (const n of notes) {
    const lines = doc.splitTextToSize(`•  ${n}`, W - 2 * M);
    doc.text(lines, M, y);
    y += lines.length * 4.4 + 1.6;
  }

  // ── Footer bar (navy), anchored near the bottom ──────────────────────
  const fY = 268;
  const fH = 22;
  doc.setFillColor(...NAVY);
  doc.rect(0, fY, W, fH, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...WHITE);
  doc.text(`Thank you for choosing ${brand.businessName || 'us'}`, M, fY + 9);
  const tagline = (brand.tagline || '').trim();
  const phone = (brand.phone || '').trim();
  const footSub = [tagline, phone ? `Call or text ${phone} to book` : ''].filter(Boolean).join('   |   ');
  if (footSub) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.8); doc.setTextColor(...FOOT_SUB);
    doc.text(footSub, M, fY + 15);
  }
  const website = (brand.website || '').trim();
  if (website) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...ORANGE);
    doc.text(website, W - M, fY + 9, { align: 'right' });
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8); doc.setTextColor(...FOOT_SUB);
  doc.text('Mobile Tire Repair  •  Available 24/7', W - M, fY + 15, { align: 'right' });

  // ── Save ─────────────────────────────────────────────────────────────
  const bizSlug = sanitizeForFilename(brand.businessName, isQuote ? 'Estimate' : 'Invoice');
  const dateSlug = (job.date || TODAY()).replace(/[^0-9-]/g, '').slice(0, 10);
  const custSlug = sanitizeForFilename(realCustomerName(job.customerName).split(/\s+/)[0], 'Customer');
  const filename = `${bizSlug}_${isQuote ? 'Estimate' : 'Invoice'}_${dateSlug}_${custSlug}.pdf`;
  doc.save(filename);
  return { filename, invoiceNumber: buildDocNumber(brand, job) };
}
