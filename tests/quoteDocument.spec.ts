// tests/quoteDocument.spec.ts
// Run: npx vitest run tests/quoteDocument.spec.ts
//
// The QUOTE document (invoice generator in quote mode) shows exactly:
// service type, tire make + model, quantity, and one total price. This
// pins the detail-row contents without rendering a PDF.

import { describe, it, expect } from 'vitest';
import { quoteDetailRows } from '@/lib/invoice';
import { EMPTY_JOB } from '@/lib/defaults';
import type { Job } from '@/types';

const job = (over: Partial<Job>): Job => ({ ...EMPTY_JOB(), ...over });
const asMap = (rows: Array<[string, string]>) => Object.fromEntries(rows);

describe('quoteDetailRows', () => {
  it('includes service type, tire make+model, size, and quantity', () => {
    const rows = quoteDetailRows(
      job({ tireBrand: 'Michelin', tireModel: 'Pilot Sport 4', tireSize: '225/45R17', qty: 4 }),
      'Tire Replacement',
    );
    const m = asMap(rows);
    expect(m.Service).toBe('Tire Replacement');
    expect(m.Tire).toBe('Michelin Pilot Sport 4'); // make + model combined
    expect(m.Size).toBe('225/45R17');
    expect(m.Quantity).toBe('4');
  });

  it('omits the Tire row when neither make nor model is set', () => {
    const rows = quoteDetailRows(job({ tireBrand: '', tireModel: '', tireSize: '', qty: 1 }), 'Flat Tire Repair');
    const labels = rows.map((r) => r[0]);
    expect(labels).not.toContain('Tire');
    expect(labels).not.toContain('Size');
    expect(labels).toEqual(['Service', 'Quantity']);
  });

  it('shows make alone, or model alone', () => {
    expect(asMap(quoteDetailRows(job({ tireBrand: 'Goodyear', tireModel: '' }), 'svc')).Tire).toBe('Goodyear');
    expect(asMap(quoteDetailRows(job({ tireBrand: '', tireModel: 'Assurance' }), 'svc')).Tire).toBe('Assurance');
  });

  it('defaults quantity to 1 when missing', () => {
    expect(asMap(quoteDetailRows(job({ qty: undefined as unknown as number }), 'svc')).Quantity).toBe('1');
  });

  it('always leads with the service type', () => {
    expect(quoteDetailRows(job({ qty: 2 }), 'Tire Rotation')[0]).toEqual(['Service', 'Tire Rotation']);
  });
});
