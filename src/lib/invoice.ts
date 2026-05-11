import { jsPDF } from 'jspdf';
import type { Job, Settings, Brand } from '@/types';
import { TODAY } from '@/lib/defaults';
import { money, r2, resolvePaymentStatus } from '@/lib/utils';

type RGB = [number, number, number];

export function generateInvoiceNumber(brand: Brand, job: Job): string {
  const slug = (brand.businessName || 'SVC').replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase();
  return slug + '-' + (job.date || '').replace(/-/g, '') + '-' + (job.id || '').slice(-4).toUpperCase();
}

export interface InvoiceResult {
  filename: string;
  invoiceNumber: string;
}

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
 * Generate a premium, mobile-business-themed invoice PDF.
 *
 * Design language:
 *   • Dark hero band — large business name, logo, contact strip, brand accent line
 *   • Two-column meta block — Bill To / Service Details on the left, Invoice meta on the right
 *   • Service breakdown table with itemized cost rows (labor, tire, material, travel)
 *   • Right-aligned totals card with prominent grand total
 *   • Payment-status badge in brand color or amber/red based on status
 *   • Footer with business contact, thank-you message, optional review CTA link
 */
export function generateInvoicePDF(job: Job, settings: Settings, brand: Brand): InvoiceResult | null {
  if (!jsPDF) {
    alert('PDF library not loaded.');
    return null;
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;
  const H = 297;
  const M = 16;
  const CONTENT_W = W - 2 * M;

  // ── Palette ──────────────────────────────────────────────
  const INK: RGB = [17, 17, 22];
  const INK_SOFT: RGB = [55, 55, 68];
  const MUTED: RGB = [128, 128, 142];
  const HAIRLINE: RGB = [220, 220, 228];
  const PANEL: RGB = [248, 248, 251];
  const WHITE: RGB = [255, 255, 255];

  const accent = hexToRgb(brand.primaryColor || '#c8a44a', [200, 164, 74]);

  // Hero background — deep charcoal, premium dark theme
  const HERO_DARK: RGB = [10, 11, 16];
  const HERO_SOFT: RGB = [22, 24, 32];

  // ── Hero header ──────────────────────────────────────────
  const heroH = 56;
  doc.setFillColor(...HERO_DARK);
  doc.rect(0, 0, W, heroH, 'F');
  // Soft top stripe for depth
  doc.setFillColor(...HERO_SOFT);
  doc.rect(0, 0, W, 6, 'F');
  // Brand accent line
  doc.setFillColor(...accent);
  doc.rect(0, heroH, W, 1.5, 'F');

  // Logo
  let textX = M;
  if (brand.logoUrl) {
    try {
      doc.addImage(brand.logoUrl, 'PNG', M, 12, 26, 26);
      textX = M + 32;
    } catch {
      try {
        doc.addImage(brand.logoUrl, 'JPEG', M, 12, 26, 26);
        textX = M + 32;
      } catch { /* skip silently */ }
    }
  }

  // Business name (large)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...WHITE);
  doc.text(brand.businessName || 'Mobile Service OS', textX, 22);

  // Tagline / business type
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(180, 180, 192);
  const tagline = [brand.businessType || 'Mobile Tire & Roadside', brand.serviceArea].filter(Boolean).join(' · ');
  if (tagline) doc.text(tagline, textX, 29);

  // Contact strip
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 165);
  const contact = [brand.phone, brand.email, brand.website].filter(Boolean).join('   ·   ');
  if (contact) doc.text(contact, textX, 36);

  // Right-side: INVOICE label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...accent);
  doc.text('INVOICE', W - M, 22, { align: 'right' });

  // Invoice number
  const invNum = job.invoiceNumber || generateInvoiceNumber(brand, job);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(200, 200, 210);
  doc.text('No. ' + invNum, W - M, 29, { align: 'right' });

  // Issue date
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 165);
  doc.text('Issued ' + (job.date || TODAY()), W - M, 35, { align: 'right' });

  // ── Bill To / Service panels ─────────────────────────────
  let y = heroH + 14;
  const panelW = (CONTENT_W - 6) / 2;
  const panelH = 38;

  // Bill To panel
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

  // Service Details panel
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

  // ── Service / cost table ─────────────────────────────────
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

  // Primary line — the headline service charge
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  let desc = job.service || 'Service';
  if (job.tireSize) desc += ' — ' + job.tireSize;
  if (job.vehicleType && job.vehicleType !== 'Car') desc += '  (' + job.vehicleType + ')';
  doc.text(desc, M + 4, y);

  const qtyStr = String(job.qty || 1);
  doc.setFontSize(9.5);
  doc.setTextColor(...INK_SOFT);
  doc.text(qtyStr, M + CONTENT_W - 42, y, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(money(job.revenue || 0), M + CONTENT_W - 4, y, { align: 'right' });
  y += 6;

  // Cost breakdown (informational sub-rows under the service line)
  const tireCost = Number(job.tireCost || 0);
  const materialCost = Number(job.materialCost || job.miscCost || 0);
  const miles = Number(job.miles || 0);
  const freeMiles = Number(settings.freeMilesIncluded || 0);
  const chargeable = Math.max(0, miles - freeMiles);
  const travelCost = r2(chargeable * Number(settings.costPerMile || 0));

  const breakdownRows: Array<[string, number]> = [];
  if (tireCost > 0) breakdownRows.push(['Tire cost (included)', tireCost]);
  if (materialCost > 0) breakdownRows.push(['Material cost (included)', materialCost]);
  if (travelCost > 0) {
    const milesLabel = freeMiles ? ` (${miles} mi, ${freeMiles} free)` : ` (${miles} mi)`;
    breakdownRows.push(['Travel' + milesLabel, travelCost]);
  }

  if (breakdownRows.length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    for (const [label, amt] of breakdownRows) {
      doc.text('  ' + label, M + 4, y);
      doc.text(money(amt), M + CONTENT_W - 4, y, { align: 'right' });
      y += 4.5;
    }
    y += 2;
  } else {
    y += 4;
  }

  // Table bottom hairline
  doc.setDrawColor(...HAIRLINE);
  doc.setLineWidth(0.3);
  doc.line(M, y, M + CONTENT_W, y);
  y += 10;

  // ── Totals card (right-aligned) ──────────────────────────
  const subtotal = Number(job.revenue || 0);
  const taxRate = Number(settings.invoiceTaxRate || 0) / 100;
  const taxAmt = r2(subtotal * taxRate);
  const total = r2(subtotal + taxAmt);

  const totalsW = 78;
  const totalsX = M + CONTENT_W - totalsW;
  const totalsRows = taxRate > 0 ? 3 : 2; // subtotal + tax? + total
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

  // Total emphasis bar
  doc.setDrawColor(...HAIRLINE);
  doc.line(totalsX + 4, ty - 2, totalsX + totalsW - 4, ty - 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text('TOTAL', totalsX + 5, ty + 4);
  doc.setTextColor(...accent);
  doc.text(money(total), totalsX + totalsW - 5, ty + 4, { align: 'right' });

  y += totalsCardH + 6;

  // ── Payment status badge ─────────────────────────────────
  const ps = resolvePaymentStatus(job);
  const badge = paymentBadgeColors(ps);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  const badgeText = badge.label;
  const badgeW = doc.getTextWidth(badgeText) + 10;
  const badgeX = M;
  doc.setFillColor(...badge.fill);
  doc.roundedRect(badgeX, y, badgeW, 7, 1.5, 1.5, 'F');
  doc.setTextColor(...badge.text);
  doc.text(badgeText, badgeX + 5, y + 4.8);

  // Payment method (right of badge)
  if (job.payment) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text('Payment method: ' + job.payment, badgeX + badgeW + 6, y + 4.8);
  }
  y += 14;

  // ── Notes ────────────────────────────────────────────────
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

  // ── Footer ───────────────────────────────────────────────
  const footerY = H - 32;

  // Thin separator
  doc.setDrawColor(...HAIRLINE);
  doc.setLineWidth(0.3);
  doc.line(M, footerY - 6, M + CONTENT_W, footerY - 6);

  // Left side: thank-you + footer message
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...INK);
  doc.text('Thank you for your business.', M, footerY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  const customFooter = brand.invoiceFooter
    || `${brand.businessName || 'Mobile Service OS'} — mobile tire & roadside service${brand.serviceArea ? ' in ' + brand.serviceArea : ''}.`;
  const footerLines = doc.splitTextToSize(customFooter, CONTENT_W * 0.55);
  doc.text(footerLines, M, footerY + 4);

  // Right side: review CTA
  if (brand.reviewUrl) {
    const rx = M + CONTENT_W;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...accent);
    doc.text('Leave a review', rx, footerY, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    // Wrap the URL onto multiple lines if needed
    const urlLines = doc.splitTextToSize(brand.reviewUrl, 70);
    doc.text(urlLines, rx, footerY + 4, { align: 'right' });
  }

  // Bottom hairline accent
  doc.setFillColor(...accent);
  doc.rect(0, H - 4, W, 4, 'F');

  const slug = (brand.businessName || 'SVC').replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const filename = slug + '-invoice-' + invNum + '.pdf';
  doc.save(filename);
  return { filename, invoiceNumber: invNum };
}
