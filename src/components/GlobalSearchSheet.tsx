// src/components/GlobalSearchSheet.tsx
// ═══════════════════════════════════════════════════════════════════
//  GlobalSearchSheet — bottom-sheet customer search surface.
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"Global Customer Search (Phase 5)"
//
//  Multi-field search (phone/name/company/vehicle/license plate/
//  tire size/city/ZIP) via searchCustomers helper. 200ms debounce.
//  Tap a result → opens CustomerProfile.
// ═══════════════════════════════════════════════════════════════════

import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { searchCustomers, type SearchResult } from '@/lib/searchCustomers';
import { formatPhoneForDisplay } from '@/lib/phone';

interface Props {
  businessId: string;
  open: boolean;
  onClose: () => void;
  onSelectCustomer?: (customerId: string) => void;
}

function GlobalSearchSheetImpl({ businessId, open, onClose, onSelectCustomer }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !businessId) return;
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    const handle = window.setTimeout(() => {
      searchCustomers(businessId, query)
        .then((rows) => {
          if (seq !== seqRef.current) return;
          setResults(rows);
          setLoading(false);
        })
        .catch((err) => {
          if (seq !== seqRef.current) return;
          console.warn('[GlobalSearchSheet] search failed', err);
          setResults([]);
          setLoading(false);
        });
    }, 200);
    return () => window.clearTimeout(handle);
  }, [businessId, query, open]);

  const onResultClick = useCallback((customerId: string) => {
    onSelectCustomer?.(customerId);
    onClose();
  }, [onSelectCustomer, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Customer search"
      style={overlayStyle}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={sheetStyle}>
        <div style={headerStyle}>
          <input
            type="search"
            placeholder="Search by phone, name, vehicle, plate, city…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            style={inputStyle}
            aria-label="Search customers"
          />
          <button type="button" onClick={onClose} style={closeBtnStyle} aria-label="Close search">
            ✕
          </button>
        </div>

        <div style={listStyle}>
          {loading && query.trim().length >= 2 && (
            <div style={emptyStyle}>Searching…</div>
          )}
          {!loading && query.trim().length < 2 && (
            <div style={hintStyle}>
              <div style={{ marginBottom: 8, fontSize: 13, color: 'var(--t2)' }}>
                Try a phone number, name, vehicle, tire size, or city.
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                Examples: <em>Tesla · 235/45R18 · Hollywood · 3058977030 · John Smith</em>
              </div>
            </div>
          )}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <div style={emptyStyle}>No matches for "{query}"</div>
          )}
          {!loading && results.map(r => (
            <button
              key={r.customer.id}
              type="button"
              style={resultStyle}
              onClick={() => onResultClick(r.customer.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t1)' }}>
                  {r.customer.name || 'Unnamed'}
                </span>
                <span style={fieldBadgeStyle}>{r.matchedField}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 3 }}>
                {r.customer.phoneE164 && <span>{formatPhoneForDisplay(r.customer.phoneE164)}</span>}
                {r.customer.city && <span> · {r.customer.city}</span>}
                {r.customer.companyName && <span> · {r.customer.companyName}</span>}
              </div>
              {r.matchedVehicles.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 3 }}>
                  {r.matchedVehicles.slice(0, 2).map(v => {
                    const tireDisp = (v as { tireSize?: string; tire?: { size?: string } }).tireSize
                      ?? (v as { tireSize?: string; tire?: { size?: string } }).tire?.size;
                    return [v.year, v.make, v.model, tireDisp].filter(Boolean).join(' ');
                  }).join(' · ')}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 100,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
};
const sheetStyle: CSSProperties = {
  width: '100%', maxWidth: 480, maxHeight: '80vh',
  background: 'var(--s1, #111)',
  borderRadius: '12px 12px 0 0',
  display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
};
const headerStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: 12, borderBottom: '1px solid var(--border, #2a2a2a)',
};
const inputStyle: CSSProperties = {
  flex: 1, padding: '10px 12px', fontSize: 14,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1, #fff)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
};
const closeBtnStyle: CSSProperties = {
  padding: '6px 10px', fontSize: 16,
  background: 'transparent', color: 'var(--t2, #aaa)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
  cursor: 'pointer',
};
const listStyle: CSSProperties = {
  flex: 1, overflowY: 'auto', padding: 12,
  display: 'flex', flexDirection: 'column', gap: 8,
};
const resultStyle: CSSProperties = {
  width: '100%', textAlign: 'left', padding: 10,
  background: 'var(--s2, #1f1f1f)',
  border: '1px solid var(--border, #2a2a2a)',
  borderRadius: 8, cursor: 'pointer', color: 'inherit',
};
const fieldBadgeStyle: CSSProperties = {
  fontSize: 10, fontWeight: 600,
  padding: '2px 6px', borderRadius: 8,
  background: 'var(--brand-primary)', color: '#1a1a1a',
  textTransform: 'uppercase',
};
const emptyStyle: CSSProperties = {
  padding: 20, textAlign: 'center', color: 'var(--t3)', fontSize: 13,
};
const hintStyle: CSSProperties = {
  padding: 16, textAlign: 'center',
};

export const GlobalSearchSheet = memo(GlobalSearchSheetImpl);
