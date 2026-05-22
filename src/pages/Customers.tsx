import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import type { Job, Settings } from '@/types';
import { PAYMENT_METHOD_LABELS } from '@/types';
import { fmtDate, money, paymentPillClass, resolvePaymentStatus, serviceIcon } from '@/lib/utils';
import { useScopedJobs } from '@/lib/useScopedJobs';
import { useMembership } from '@/context/MembershipContext';
import { scopedCol, fbSet } from '@/lib/firebase';
import { deriveCustomerProfiles, type CustomerProfile } from '@/lib/customers';
import { addToast } from '@/lib/toast';

interface Props {
  jobs: Job[];
  settings: Settings;
}

// ─────────────────────────────────────────────────────────────────────
//  Customers — CRM. Two states: a derived list, and an in-page
//  profile drill-down. Every field is computed live from jobs
//  (see lib/customers.ts); the only persisted datum is a free-text
//  operator note at customers/{key}.
// ─────────────────────────────────────────────────────────────────────

export function Customers({ jobs: rawJobs, settings }: Props) {
  // Technicians see only customers from their own scoped jobs.
  const jobs = useScopedJobs(rawJobs);
  const { member, role, permissions } = useMembership();
  const businessId = member?.businessId || null;
  const canEditNote = role === 'owner' || role === 'admin';
  // Technicians see revenue but not profit (matches the rest of
  // the app's revenue/profit split).
  const canViewProfit = permissions.canViewProfit;

  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const customers = useMemo(
    () => deriveCustomerProfiles(jobs, settings),
    [jobs, settings],
  );

  const selected = useMemo(
    () => customers.find((c) => c.key === selectedKey) || null,
    [customers, selectedKey],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      c.name.toLowerCase().includes(q) || c.phone.includes(q));
  }, [customers, query]);

  // ── Profile drill-down ──────────────────────────────────────────
  if (selected) {
    return (
      <CustomerProfileView
        profile={selected}
        settings={settings}
        businessId={businessId}
        canEditNote={canEditNote}
        canViewProfit={canViewProfit}
        onBack={() => setSelectedKey(null)}
      />
    );
  }

  // ── List ────────────────────────────────────────────────────────
  const topThree = customers.slice(0, 3);

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Customers</div>

      <div className={'kpi-grid' + (canViewProfit ? ' three' : '')}>
        <div className="kpi"><div className="kpi-label">Total</div><div className="kpi-value">{customers.length}</div></div>
        <div className="kpi"><div className="kpi-label">Revenue</div><div className="kpi-value">{money(customers.reduce((s, c) => s + c.revenue, 0))}</div></div>
        {canViewProfit && (
          <div className="kpi"><div className="kpi-label">Profit</div><div className="kpi-value">{money(customers.reduce((s, c) => s + c.profit, 0))}</div></div>
        )}
      </div>

      {topThree.length > 0 && (
        <>
          <div className="section-label">Top Customers</div>
          <div className="card card-anim">
            <div className="card-pad">
              {topThree.map((c, i) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setSelectedKey(c.key)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    width: '100%', padding: '8px 0', background: 'transparent', border: 'none',
                    borderTop: i ? '1px solid var(--border2)' : 'none',
                    color: 'var(--t1)', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {c.name}
                      {c.isRepeat && <RepeatBadge />}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{c.jobCount} job{c.jobCount !== 1 ? 's' : ''}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="value green num">{money(c.revenue)}</div>
                    {canViewProfit && (
                      <div style={{ fontSize: 11, color: 'var(--t3)' }}>profit {money(c.profit)}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="field" style={{ marginTop: 14, marginBottom: 10 }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or phone…" />
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">👥</div>
          <div className="empty-state-title">No customers yet</div>
          <div className="empty-state-sub">Customers appear automatically as you log jobs.</div>
        </div>
      ) : (
        <div className="stack">
          {filtered.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setSelectedKey(c.key)}
              className="card card-anim"
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                color: 'var(--t1)', cursor: 'pointer', padding: 0,
              }}
            >
              <div className="card-pad">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {c.name}
                      {c.isRepeat && <RepeatBadge />}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{c.phone || 'No phone'}</div>
                  </div>
                  {c.unpaidCount > 0 && (
                    <span className="pill red" style={{ fontSize: 9 }}>
                      {c.unpaidCount} unpaid
                    </span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 12 }}>
                  <div><div style={{ color: 'var(--t3)' }}>Jobs</div><div style={{ fontWeight: 700 }}>{c.jobCount}</div></div>
                  <div><div style={{ color: 'var(--t3)' }}>Revenue</div><div style={{ fontWeight: 700, color: 'var(--green)' }}>{money(c.revenue)}</div></div>
                  <div><div style={{ color: 'var(--t3)' }}>Last</div><div style={{ fontWeight: 700 }}>{c.lastDate ? fmtDate(c.lastDate) : '—'}</div></div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Repeat-customer badge ─────────────────────────────────────────
function RepeatBadge() {
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
      color: 'var(--brand-primary)', background: 'rgba(244,180,0,.12)',
      border: '1px solid rgba(244,180,0,.3)', borderRadius: 999, padding: '2px 7px',
    }}>
      ★ Repeat
    </span>
  );
}

// ─── Profile drill-down ────────────────────────────────────────────
function CustomerProfileView({
  profile, settings, businessId, canEditNote, canViewProfit, onBack,
}: {
  profile: CustomerProfile;
  settings: Settings;
  businessId: string | null;
  canEditNote: boolean;
  canViewProfit: boolean;
  onBack: () => void;
}) {
  const phoneDigits = profile.phone.replace(/\D/g, '');

  // ── Editable operator note (persisted at customers/{key}) ────────
  const [note, setNote] = useState('');
  const [noteLoaded, setNoteLoaded] = useState(false);
  const [noteDirty, setNoteDirty] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const col = businessId ? scopedCol(businessId, 'customers') : null;
    if (!col) { setNoteLoaded(true); return; }
    getDoc(doc(col, profile.key))
      .then((snap) => {
        if (cancelled) return;
        const data = snap.exists() ? (snap.data() as { note?: unknown }) : null;
        setNote(typeof data?.note === 'string' ? data.note : '');
        setNoteLoaded(true);
      })
      .catch(() => { if (!cancelled) setNoteLoaded(true); });
    return () => { cancelled = true; };
  }, [businessId, profile.key]);

  const saveNote = async () => {
    const col = businessId ? scopedCol(businessId, 'customers') : null;
    if (!col) return;
    setSavingNote(true);
    try {
      await fbSet(col, profile.key, {
        note: note.trim(),
        updatedAt: new Date().toISOString(),
      });
      setNoteDirty(false);
      addToast('Note saved', 'success');
    } catch {
      addToast('Could not save note', 'error');
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="page page-enter">
      <button
        type="button"
        onClick={onBack}
        className="btn sm secondary"
        style={{ marginBottom: 14 }}
      >← Customers</button>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>{profile.name}</div>
        {profile.isRepeat && <RepeatBadge />}
      </div>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 14 }}>
        {profile.phone || 'No phone on file'}
        {profile.email ? ` · ${profile.email}` : ''}
      </div>

      {phoneDigits && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <a className="btn sm secondary" href={`tel:${phoneDigits}`} style={{ flex: 1, textAlign: 'center' }}>📞 Call</a>
          <a className="btn sm secondary" href={`sms:${phoneDigits}`} style={{ flex: 1, textAlign: 'center' }}>💬 Text</a>
        </div>
      )}

      {/* Lifetime stats */}
      <div className="form-group">
        <div className="form-group-title">Lifetime</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          <Stat label="Jobs" value={String(profile.jobCount)} />
          <Stat label="Revenue" value={money(profile.revenue)} green />
          {canViewProfit && (
            <Stat label="Profit" value={money(profile.profit)} green={profile.profit >= 0} />
          )}
          <Stat label="Reviews sent" value={String(profile.reviewsSent)} />
          <Stat label="First seen" value={profile.firstDate ? fmtDate(profile.firstDate) : '—'} />
          <Stat label="Last seen" value={profile.lastDate ? fmtDate(profile.lastDate) : '—'} />
        </div>
        {profile.unpaidCount > 0 && (
          <div style={{
            marginTop: 10, padding: '8px 12px', borderRadius: 8,
            background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)',
            fontSize: 12, color: 'var(--red)', fontWeight: 700,
          }}>
            {profile.unpaidCount} unpaid job{profile.unpaidCount !== 1 ? 's' : ''} · {money(profile.unpaidTotal)} outstanding
          </div>
        )}
      </div>

      {/* Vehicles / tire sizes — whichever the customer's jobs carry. */}
      {(profile.vehicles.length > 0 || profile.tireSizes.length > 0 || profile.paymentMethods.length > 0) && (
        <div className="form-group">
          <div className="form-group-title">History</div>
          {profile.vehicles.length > 0 && (
            <Row label="Vehicles" value={profile.vehicles.join(', ')} />
          )}
          {profile.tireSizes.length > 0 && (
            <Row label="Tire sizes" value={profile.tireSizes.join(', ')} />
          )}
          {profile.paymentMethods.length > 0 && (
            <Row
              label="Paid via"
              value={profile.paymentMethods
                .map((m) => PAYMENT_METHOD_LABELS[m as keyof typeof PAYMENT_METHOD_LABELS] ?? m)
                .join(', ')}
            />
          )}
        </div>
      )}

      {/* Operator note */}
      <div className="form-group">
        <div className="form-group-title">Notes</div>
        {!noteLoaded ? (
          <div style={{ fontSize: 12, color: 'var(--t3)' }}>Loading…</div>
        ) : canEditNote ? (
          <>
            <textarea
              value={note}
              onChange={(e) => { setNote(e.target.value); setNoteDirty(true); }}
              placeholder="Gate code, access notes, preferences, anything worth remembering…"
              rows={3}
              style={{ width: '100%', fontSize: 14, padding: 10, borderRadius: 8 }}
            />
            {noteDirty && (
              <button
                type="button"
                className="btn sm primary"
                onClick={saveNote}
                disabled={savingNote}
                style={{ marginTop: 8 }}
              >
                {savingNote ? 'Saving…' : 'Save Note'}
              </button>
            )}
          </>
        ) : (
          <div style={{ fontSize: 13, color: note ? 'var(--t2)' : 'var(--t3)' }}>
            {note || 'No notes.'}
          </div>
        )}
      </div>

      {/* Job history */}
      <div className="section-label">Job History</div>
      <div className="stack">
        {profile.jobs.map((j) => {
          const ps = resolvePaymentStatus(j);
          return (
            <div key={j.id} className="card">
              <div className="card-pad" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 20 }}>{serviceIcon(j.service)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {j.service}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                    {j.date ? fmtDate(j.date) : '—'}
                    {j.fullLocationLabel ? ` · ${j.fullLocationLabel}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="value green num">{money(j.revenue)}</div>
                  <span className={'pill ' + paymentPillClass(ps)} style={{ fontSize: 9, marginTop: 2 }}>{ps}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: green ? 'var(--green)' : 'var(--t1)' }}>{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-row" style={{ padding: '6px 0' }}>
      <span className="label">{label}</span>
      <span className="value" style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}
