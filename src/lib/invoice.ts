import { jsPDF } from 'jspdf';
import type { Job, Settings, Brand } from '@/types';
import { TODAY } from '@/lib/defaults';
import { money, r2, resolvePaymentStatus } from '@/lib/utils';

type RGB = [number, number, number];

export function generateInvoiceNumber(brand: Brand, job: Job): string {
  const cleaned = (brand.businessName || '').replace(/[^A-Z0-9]/gi, '');
  const prefix = cleaned ? cleaned.slice(0, 4).toUpperCase() : 'INV';
  return prefix + '-' + (job.date || '').replace(/-/g, '') + '-' + (job.id || '').slice(-4).toUpperCase();
}

export interface InvoiceResult {
  filename: string;
  invoiceNumber: string;
}

export interface InvoiceLineItem {
  label: string;
  qty: number;
  amount: number;
}

// ── Line-item builder ──────────────────────────────────────
// This is the heart of the new transparent-pricing invoice. The function is
// pure (no side effects, no PDF rendering) so we can unit-test it and call it
// from anywhere — invoice PDF, on-screen preview, email summaries, etc.
//
// Constraints, derived from the spec:
//   • Travel cost is NEVER shown as a line item. It's used internally only.
//   • The lines must sum to `revenue` exactly — we balance any rounding into
//     the dispatch line which is the most generic of the three.
//   • Tire Replacement (transparent) → 3 lines: Tire, Mobile Service & Dispatch,
//     Mounting & Balancing
//   • Tire Installation (transparent) → 2 lines: Mobile Service & Dispatch,
//     Mounting & Balancing  (customer supplies tire, so no Tire line)
//   • Flat repair / other services / single style → 1 line: the service name
//
// Split heuristic: of the non-tire revenue, dispatch gets ~55%, mounting ~45%.
// This mirrors the spec example (revenue $170, tire $50 → $65 dispatch + $55
// mounting). The dispatch share is intentionally a bit larger because it
// absorbs the hidden travel cost.

const DEFAULT_DISPATCH_LABEL = 'Mobile Service & Dispatch';
const DEFAULT_MOUNTING_LABEL = 'Mounting & Balancing';

function isReplacement(service: string): boolean {
  return service === 'Tire Replacement';
}
function isInstallation(service: string): boolean {
  return service === 'Tire Installation';
}

export function buildInvoiceLines(job: Job, settings: Settings): InvoiceLineItem[] {
  const style = settings.invoicePricingStyle === 'single' ? 'single' : 'transparent';
  const revenue = r2(Number(job.revenue || 0));
  const tireCost = r2(Number(job.tireCost || 0));
  const qty = Math.max(1, Math.floor(Number(job.qty) || 1));

  // Single-line mode (or any non-replacement/installation service in
  // transparent mode) keeps the simpler format.
  if (style === 'single' || (!isReplacement(job.service) && !isInstallation(job.service))) {
    return [{ label: job.service || 'Service', qty, amount: revenue }];
  }

  // ── Replacement: Tire + Dispatch + Mounting ──
  if (isReplacement(job.service)) {
    const tireLine = Math.min(tireCost, revenue); // never let tire line exceed total
    const remainder = r2(revenue - tireLine);
    // Split the non-tire amount: ~55% dispatch, ~45% mounting.
    let dispatchLine = Math.round(remainder * 0.55);
    let mountingLine = r2(remainder - dispatchLine);
    // Defensive: if revenue is tiny / weird, fall back to single line.
    if (remainder <= 0 || dispatchLine < 0 || mountingLine < 0) {
      return [{ label: job.service, qty, amount: revenue }];
    }
    // Push tiny rounding remainders into dispatch so the lines sum exactly.
    const sumCheck = r2(tireLine + dispatchLine + mountingLine);
    const drift = r2(revenue - sumCheck);
    if (drift !== 0) dispatchLine = r2(dispatchLine + drift);
    return [
      { label: 'Tire', qty, amount: tireLine },
      { label: DEFAULT_DISPATCH_LABEL, qty: 1, amount: dispatchLine },
      { label: DEFAULT_MOUNTING_LABEL, qty: 1, amount: mountingLine },
    ];
  }

  // ── Installation (customer-supplied tires): Dispatch + Mounting ──
  // No tire line since the customer brought the tires. The whole revenue
  // is labor + dispatch, split 55/45.
  if (isInstallation(job.service)) {
    let dispatchLine = Math.round(revenue * 0.55);
    let mountingLine = r2(revenue - dispatchLine);
    if (dispatchLine < 0 || mountingLine < 0) {
      return [{ label: job.service, qty, amount: revenue }];
    }
    const sumCheck = r2(dispatchLine + mountingLine);
    const drift = r2(revenue - sumCheck);
    if (drift !== 0) dispatchLine = r2(dispatchLine + drift);
    return [
      { label: DEFAULT_DISPATCH_LABEL, qty: 1, amount: dispatchLine },
      { label: DEFAULT_MOUNTING_LABEL, qty: 1, amount: mountingLine },
    ];
  }

  // Unreachable, but TypeScript wants a return.
  return [{ label: job.service, qty, amount: revenue }];
}

// ── Color + helpers ────────────────────────────────────────

function hexToRgb(hex: string, fallback: RGB): RGB {
  if (!hex || hex[0] !== '#' || (hex.length !== 7 && hex.length !== 4)) return fallback;
  const full = hex.length === 4
    ? '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
    : hex;
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return fallback;
  return [r, g, b];
}

function paymentBadgeColors(status: string): { fill: RGB; text: RGB; label: string } {
  if (status === 'Paid') return { fill: [220, 252, 231], text: [22, 101, 52], label: 'PAID' };
  if (status === 'Pending Payment') return { fill: [255, 237, 213], text: [154, 52, 18], label: 'PAYMENT PENDING' };
  if (status === 'Partial Payment') return { fill: [255, 237, 213], text: [154, 52, 18], label: 'PARTIAL PAYMENT' };
  if (status === 'Cancelled') return { fill: [254, 226, 226], text: [153, 27, 27], label: 'CANCELLED' };
  return { fill: [241, 245, 249], text: [51, 65, 85], label: status.toUpperCase() };
}

function locationLine(job: Job): string {
  if (job.fullLocationLabel) return job.fullLocationLabel;
  if (job.city && job.state) return `${job.city}, ${job.state}`;
  return job.city || job.area || '';
}

/**
 * Generate a premium, mobile-business-themed invoice PDF for the tenant.
 *
 * All branded text comes from the `brand` argument (businesses/{uid}/settings/
 * main). The SaaS platform name is NEVER printed on a tenant invoice.
 *
 * Travel cost is computed internally for profit math but is NOT shown as a
 * line item — it's absorbed into the "Mobile Service & Dispatch" line.
 */
export function generateInvoicePDF(job: Job, settings: Settings, brand: Brand): InvoiceResult | null {
  if (!jsPDF) {
    alert('PDF library not loaded.');
    return null;
  }

  const tenantName = (brand.businessName || '').trim() || 'Mobile Tire & Roadside Service';
  const tenantTagline = [
    (brand.businessType || '').trim() || 'Mobile Tire & Roadside',
    (brand.serviceArea || '').trim(),
  ].filter(Boolean).join(' · ');
  const tenantContact = [brand.phone, brand.email, brand.website].filter(Boolean).join('   ·   ');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;
  const H = 297;
  const M = 16;
  const CONTENT_W = W - 2 * M;

  // ── Palette ──
  const INK: RGB = [17, 17, 22];
  const INK_SOFT: RGB = [55, 55, 68];
  const MUTED: RGB = [128, 128, 142];
  const HAIRLINE: RGB = [220, 220, 228];
  const PANEL: RGB = [248, 248, 251];
  const WHITE: RGB = [255, 255, 255];
  const accent = hexToRgb(brand.primaryColor || '#c8a44a', [200, 164, 74]);
  const HERO_DARK: RGB = [10, 11, 16];
  const HERO_SOFT: RGB = [22, 24, 32];

  // ── Hero header ──
  const heroH = 56;
  doc.setFillColor(...HERO_DARK);
  doc.rect(0, 0, W, heroH, 'F');
  doc.setFillColor(...HERO_SOFT);
  doc.rect(0, 0, W, 6, 'F');
  doc.setFillColor(...accent);
  doc.rect(0, heroH, W, 1.5, 'F');

  let textX = M;
  if (brand.logoUrl) {
    try {
      doc.addImage(brand.logoUrl, 'PNG', M, 12, 26, 26);
      textX = M + 32;
    } catch {
      try {
        doc.addImage(brand.logoUrl, 'JPEG', M, 12, 26, 26);
        textX = M + 32;
      } catch { /* skip */ }
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...WHITE);
  doc.text(tenantName, textX, 22);

  if (tenantTagline) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(180, 180, 192);
    doc.text(tenantTagline, textX, 29);
  }

  if (tenantContact) {
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 165);
    doc.text(tenantContact, textX, 36);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...accent);
  doc.text('INVOICE', W - M, 22, { align: 'right' });

  const invNum = job.invoiceNumber || generateInvoiceNumber(brand, job);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(200, 200, 210);
  doc.text('No. ' + invNum, W - M, 29, { align: 'right' });
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 165);
  doc.text('Issued ' + (job.date || TODAY()), W - M, 35, { align: 'right' });

  // ── Bill To / Service panels ──
  let y = heroH + 14;
  const panelW = (CONTENT_W - 6) / 2;
  const panelH = 38;

  doc.setFillColor(...PANEL);
  doc.roundedRect(M, y, panelW, panelH, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text('BILL TO', M + 5, y + 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(job.customerName || 'Customer', M + 5, y + 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...INK_SOFT);
  let ly = y + 19;
  if (job.customerPhone) { doc.text(job.customerPhone, M + 5, ly); ly += 4.5; }
  const loc = locationLine(job);
  if (loc) { doc.text(loc, M + 5, ly); ly += 4.5; }
  if (job.vehicleType) { doc.text('Vehicle: ' + job.vehicleType, M + 5, ly); ly += 4.5; }

  const sx = M + panelW + 6;
  doc.setFillColor(...PANEL);
  doc.roundedRect(sx, y, panelW, panelH, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text('SERVICE PERFORMED', sx + 5, y + 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(job.service || 'Service', sx + 5, y + 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...INK_SOFT);
  let sy = y + 19;
  if (job.tireSize) {
    const qtyLabel = Number(job.qty || 0) > 0 ? `× ${job.qty}` : '';
    doc.text(`Tire: ${job.tireSize} ${qtyLabel}`.trim(), sx + 5, sy);
    sy += 4.5;
  }
  if (job.tireSource) { doc.text('Source: ' + job.tireSource, sx + 5, sy); sy += 4.5; }
  if (job.date) { doc.text('Service date: ' + job.date, sx + 5, sy); sy += 4.5; }

  y += panelH + 12;

  // ── Service line items ──
  // Build the line items from the new pure function. This is where the
  // transparent-pricing magic happens — but the PDF rendering below is
  // agnostic to whether we got 1, 2, or 3 lines.
  const lines = buildInvoiceLines(job, settings);

  // Table head
  doc.setFillColor(...INK);
  doc.rect(M, y, CONTENT_W, 9, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...WHITE);
  doc.text('DESCRIPTION', M + 4, y + 6);
  doc.text('QTY', M + CONTENT_W - 42, y + 6, { align: 'right' });
  doc.text('AMOUNT', M + CONTENT_W - 4, y + 6, { align: 'right' });
  y += 13;

  // Each line item
  for (let i = 0; i < lines.length; i++) {
    const li = lines[i];
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(li.label, M + 4, y);

    doc.setFontSize(9.5);
    doc.setTextColor(...INK_SOFT);
    doc.text(String(li.qty || 1), M + CONTENT_W - 42, y, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(money(li.amount), M + CONTENT_W - 4, y, { align: 'right' });

    y += 7;

    // Hairline between line items (not after the last one)
    if (i < lines.length - 1) {
      doc.setDrawColor(...HAIRLINE);
      doc.setLineWidth(0.2);
      doc.line(M + 4, y - 2, M + CONTENT_W - 4, y - 2);
      y += 1;
    }
  }

  // Closing hairline under the table
  y += 4;
  doc.setDrawColor(...HAIRLINE);
  doc.setLineWidth(0.3);
  doc.line(M, y, M + CONTENT_W, y);
  y += 10;

  // ── Totals card ──
  const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));
  const taxRate = Number(settings.invoiceTaxRate || 0) / 100;
  const taxAmt = r2(subtotal * taxRate);
  const total = r2(subtotal + taxAmt);

  const totalsW = 78;
  const totalsX = M + CONTENT_W - totalsW;
  const totalsRows = taxRate > 0 ? 3 : 2;
  const totalsCardH = 10 + totalsRows * 8;

  doc.setFillColor(...PANEL);
  doc.roundedRect(totalsX, y, totalsW, totalsCardH, 2, 2, 'F');

  let ty = y + 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text('Subtotal', totalsX + 5, ty);
  doc.setTextColor(...INK_SOFT);
  doc.text(money(subtotal), totalsX + totalsW - 5, ty, { align: 'right' });
  ty += 7;

  if (taxRate > 0) {
    doc.setTextColor(...MUTED);
    doc.text(`Tax (${settings.invoiceTaxRate}%)`, totalsX + 5, ty);
    doc.setTextColor(...INK_SOFT);
    doc.text(money(taxAmt), totalsX + totalsW - 5, ty, { align: 'right' });
    ty += 7;
  }

  doc.setDrawColor(...HAIRLINE);
  doc.line(totalsX + 4, ty - 2, totalsX + totalsW - 4, ty - 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text('TOTAL', totalsX + 5, ty + 4);
  doc.setTextColor(...accent);
  doc.text(money(total), totalsX + totalsW - 5, ty + 4, { align: 'right' });

  y += totalsCardH + 6;

  // ── Payment status badge ──
  const ps = resolvePaymentStatus(job);
  const badge = paymentBadgeColors(ps);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  const badgeText = badge.label;
  const badgeW = doc.getTextWidth(badgeText) + 10;
  doc.setFillColor(...badge.fill);
  doc.roundedRect(M, y, badgeW, 7, 1.5, 1.5, 'F');
  doc.setTextColor(...badge.text);
  doc.text(badgeText, M + 5, y + 4.8);

  if (job.payment) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text('Payment method: ' + job.payment, M + badgeW + 6, y + 4.8);
  }
  y += 14;

  // ── Notes ──
  if (job.note && job.note.trim()) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text('NOTES', M, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...INK_SOFT);
    const noteLines = doc.splitTextToSize(job.note, CONTENT_W);
    doc.text(noteLines, M, y);
    y += noteLines.length * 4.5 + 6;
  }

  // ── Footer ──
  const footerY = H - 32;
  doc.setDrawColor(...HAIRLINE);
  doc.setLineWidth(0.3);
  doc.line(M, footerY - 6, M + CONTENT_W, footerY - 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text('Thank you for your business.', M, footerY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  const brandFooter = (brand.invoiceFooter || '').trim();
  const derivedFooter = brand.serviceArea
    ? `${tenantName} — mobile tire & roadside service in ${brand.serviceArea}.`
    : `${tenantName} — mobile tire & roadside service.`;
  const customFooter = brandFooter || derivedFooter;
  const footerLines = doc.splitTextToSize(customFooter, CONTENT_W * 0.55);
  doc.text(footerLines, M, footerY + 4);

  if (brand.reviewUrl) {
    const rx = M + CONTENT_W;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...accent);
    doc.text('Leave a review', rx, footerY, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    const urlLines = doc.splitTextToSize(brand.reviewUrl, 70);
    doc.text(urlLines, rx, footerY + 4, { align: 'right' });
  }

  doc.setFillColor(...accent);
  doc.rect(0, H - 4, W, 4, 'F');

  const tenantSlug = (brand.businessName || '').replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const slug = tenantSlug || 'invoice';
  const filename = `${slug}-${invNum}.pdf`;
  doc.save(filename);
  return { filename, invoiceNumber: invNum };
}
