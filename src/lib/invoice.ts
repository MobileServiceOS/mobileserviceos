import { jsPDF } from 'jspdf';
import type { Job, Settings, Brand } from '@/types';
import { TODAY } from '@/lib/defaults';
import { money, r2, resolvePaymentStatus } from '@/lib/utils';

export function generateInvoiceNumber(brand: Brand, job: Job): string {
  const slug = (brand.businessName || 'SVC').replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase();
  return slug + '-' + (job.date || '').replace(/-/g, '') + '-' + (job.id || '').slice(-4).toUpperCase();
}

export interface InvoiceResult {
  filename: string;
  invoiceNumber: string;
}

export function generateInvoicePDF(job: Job, settings: Settings, brand: Brand): InvoiceResult | null {
  if (!jsPDF) {
    alert('PDF library not loaded.');
    return null;
  }
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210,
    M = 18;
  const WHITE: [number, number, number] = [255, 255, 255];
  const NEAR_BLK: [number, number, number] = [20, 20, 20];
  const GRAY: [number, number, number] = [110, 110, 125];
  const LGRAY: [number, number, number] = [215, 215, 222];

  const pc = brand.primaryColor || '#c8a44a';
  const hR = parseInt(pc.slice(1, 3), 16),
    hG = parseInt(pc.slice(3, 5), 16),
    hB = parseInt(pc.slice(5, 7), 16);

  // Header band
  doc.setFillColor(11, 11, 11);
  doc.rect(0, 0, W, 44, 'F');
  doc.setFillColor(hR, hG, hB);
  doc.rect(0, 44, W, 3, 'F');

  if (brand.logoUrl) {
    try {
      doc.addImage(brand.logoUrl, 'PNG', M, 8, 24, 24);
    } catch {
      /* ignore */
    }
  }
  const textX = brand.logoUrl ? M + 30 : M;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...WHITE);
  doc.text(brand.businessName || 'Mobile Service OS', textX, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(200, 200, 210);
  const infoLine = [brand.businessType, brand.serviceArea, brand.phone, brand.email].filter(Boolean).join('  ·  ');
  doc.text(infoLine || '', textX, 28);
  if (brand.website) doc.text(brand.website, textX, 34);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(hR, hG, hB);
  doc.text('INVOICE', W - M, 20, { align: 'right' });

  const invNum = job.invoiceNumber || generateInvoiceNumber(brand, job);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(200, 200, 210);
  doc.text('#' + invNum, W - M, 28, { align: 'right' });

  let y = 54;

  // Bill To / Date
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text('BILL TO', M, y);
  doc.text('DATE', 130, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...NEAR_BLK);
  doc.text(job.customerName || 'Customer', M, y);
  doc.text(job.date || TODAY(), 130, y);
  y += 5;
  if (job.customerPhone) {
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text(job.customerPhone, M, y);
    y += 5;
  }
  if (job.area) {
    doc.text(job.area, M, y);
    y += 5;
  }
  if (job.vehicleType) {
    doc.text('Vehicle: ' + job.vehicleType, M, y);
    y += 5;
  }
  y += 8;

  // Line item table
  doc.setFillColor(245, 245, 250);
  doc.rect(M, y, W - 2 * M, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text('DESCRIPTION', M + 3, y + 5.5);
  doc.text('QTY', 120, y + 5.5);
  doc.text('AMOUNT', W - M - 3, y + 5.5, { align: 'right' });
  y += 12;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...NEAR_BLK);
  let desc = job.service || 'Service';
  if (job.tireSize) desc += ' — ' + job.tireSize;
  if (job.vehicleType && job.vehicleType !== 'Car') desc += ' (' + job.vehicleType + ')';
  doc.text(desc, M + 3, y + 4);
  doc.text(String(job.qty || 1), 122, y + 4);
  doc.setFont('helvetica', 'bold');
  doc.text(money(job.revenue || 0), W - M - 3, y + 4, { align: 'right' });
  y += 10;

  // Totals
  doc.setDrawColor(...LGRAY);
  doc.line(M, y, W - M, y);
  y += 8;
  const subtotal = Number(job.revenue || 0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GRAY);
  doc.text('Subtotal', M + 3, y + 4);
  doc.text(money(subtotal), W - M - 3, y + 4, { align: 'right' });
  y += 8;

  const taxRate = Number(settings.invoiceTaxRate || 0) / 100;
  const taxAmt = r2(subtotal * taxRate);
  if (taxRate > 0) {
    doc.text('Tax (' + settings.invoiceTaxRate + '%)', M + 3, y + 4);
    doc.text(money(taxAmt), W - M - 3, y + 4, { align: 'right' });
    y += 8;
  }

  const total = r2(subtotal + taxAmt);
  doc.setDrawColor(...LGRAY);
  doc.line(M, y, W - M, y);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...NEAR_BLK);
  doc.text('TOTAL', M + 3, y + 5);
  doc.text(money(total), W - M - 3, y + 5, { align: 'right' });
  y += 14;

  const ps = resolvePaymentStatus(job);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GRAY);
  doc.text('Payment Method: ' + (job.payment || '—'), M, y);
  y += 6;
  doc.text('Payment Status: ' + ps, M, y);
  y += 6;

  if (job.note) {
    y += 4;
    doc.setFontSize(8);
    doc.text('Notes: ' + job.note, M, y, { maxWidth: W - 2 * M });
    y += 8;
  }

  if (brand.invoiceFooter) {
    y = Math.max(y + 10, 260);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(brand.invoiceFooter, W / 2, y, { align: 'center', maxWidth: W - 2 * M });
  }

  const slug = (brand.businessName || 'SVC').replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const filename = slug + '-invoice-' + invNum + '.pdf';
  doc.save(filename);
  return { filename, invoiceNumber: invNum };
}
