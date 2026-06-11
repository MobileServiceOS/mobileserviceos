// src/components/zettle/ZettlePaymentBlock.tsx
// ═══════════════════════════════════════════════════════════════════
//  Per-job Zettle payment status (Feature 5).
//
//  Tech-safe summary (everyone): Paid by Zettle · amount · date ·
//  matched status — all from the JOB doc, which carries only tech-safe
//  pointers (paymentSource / paymentImportId / paidAt).
//
//  Owner/admin (canViewDetails): transaction id, card / method, fees
//  (when available), and matching confidence — read from the gated
//  zettleSecure payments doc. Technicians never fetch it (rule-denied →
//  null), and we don't even attempt the read unless canViewDetails.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import type { Job } from '@/types';
import { money } from '@/lib/utils';
import { getZettlePaymentDetails, type ZettlePaymentDetail } from '@/lib/zettlePayments';

interface Props {
  businessId: string;
  job: Job;
  /** Owner/admin — may see transaction id, fees, confidence. */
  canViewDetails: boolean;
}

function fmtWhen(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'High', low: 'Low', none: 'Unmatched',
};

export function ZettlePaymentBlock({ businessId, job, canViewDetails }: Props) {
  const [detail, setDetail] = useState<ZettlePaymentDetail | null>(null);
  const paymentId = job.paymentImportId;
  const matched = !!paymentId;

  useEffect(() => {
    if (!canViewDetails || !businessId || !paymentId) return;
    let active = true;
    void getZettlePaymentDetails(businessId, paymentId).then((d) => { if (active) setDetail(d); });
    return () => { active = false; };
  }, [canViewDetails, businessId, paymentId]);

  return (
    <div className="form-group" style={wrap}>
      <div style={head}>
        <span style={{ fontSize: 15 }} aria-hidden>💳</span>
        <span style={{ fontWeight: 700, fontSize: 13 }}>Paid by Zettle</span>
        <span style={matched ? pillOk : pillWarn}>{matched ? 'Matched' : 'Unmatched'}</span>
      </div>

      {/* Tech-safe summary — from the job doc */}
      <Row label="Amount" value={money(job.revenue)} bold />
      <Row label="Payment date" value={fmtWhen(job.paidAt)} />

      {/* Owner/admin-only details — from the gated payments doc */}
      {canViewDetails && detail && (
        <>
          <div style={divider} />
          {(detail.cardBrand || detail.paymentType) && (
            <Row
              label="Method"
              value={[detail.cardBrand, detail.maskedPan ? `•• ${detail.maskedPan.slice(-4)}` : null]
                .filter(Boolean).join(' ') || detail.paymentType || 'Card'}
            />
          )}
          {detail.feeAmount != null && <Row label="Fee" value={money(detail.feeAmount)} />}
          {detail.netAmount != null && <Row label="Net" value={money(detail.netAmount)} />}
          {detail.matchConfidence && (
            <Row label="Match confidence" value={CONFIDENCE_LABEL[detail.matchConfidence] ?? detail.matchConfidence} />
          )}
          <Row label="Transaction ID" value={detail.transactionId} mono />
        </>
      )}
    </div>
  );
}

function Row({ label, value, bold, mono }: { label: string; value: string; bold?: boolean; mono?: boolean }) {
  return (
    <div style={row}>
      <span style={{ color: 'var(--t3)', fontSize: 12 }}>{label}</span>
      <span style={{
        fontSize: mono ? 11 : 13, fontWeight: bold ? 700 : 500,
        fontFamily: mono ? 'ui-monospace, monospace' : undefined,
        wordBreak: mono ? 'break-all' : undefined, textAlign: 'right', maxWidth: '60%',
      }}>{value}</span>
    </div>
  );
}

const wrap: React.CSSProperties = {
  border: '1px solid var(--border, #e2e2e2)', borderRadius: 10, padding: 12, marginBottom: 12,
  display: 'flex', flexDirection: 'column', gap: 6,
};
const head: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 };
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 };
const divider: React.CSSProperties = { height: 1, background: 'var(--border, #ececec)', margin: '4px 0' };
const pillBase: React.CSSProperties = {
  marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
};
const pillOk: React.CSSProperties = { ...pillBase, background: 'rgba(34,197,94,.15)', color: 'var(--green, #16a34a)' };
const pillWarn: React.CSSProperties = { ...pillBase, background: 'rgba(245,158,11,.15)', color: 'var(--amber, #d97706)' };
