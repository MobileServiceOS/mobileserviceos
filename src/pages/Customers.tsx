import { useEffect, useMemo, useState } from 'react';
import type { Job, Settings } from '@/types';
import { PAYMENT_METHOD_LABELS } from '@/types';
import { fmtDate, money, paymentPillClass, resolvePaymentStatus, serviceIcon } from '@/lib/utils';
import { useScopedJobs } from '@/lib/useScopedJobs';
import { useMembership } from '@/context/MembershipContext';
import { scopedCol, fbSet } from '@/lib/firebase';
import {
  deriveCustomerProfiles, type CustomerProfile,
  type CustomerMeta, PRESET_CUSTOMER_TAGS,
  customersToCsv,
} from '@/lib/customers';
import { addToast } from '@/lib/toast';

interface Props {
  jobs: Job[];
  settings: Settings;
  /** Live snapshot of all persisted per-customer metadata (notes +
   *  tags). Subscribed at App level; passed here so the list view
   *  can render tag chips and filter by tag without per-row reads. */
  customerMeta: Map<string, CustomerMeta>;
  /** Open the job-detail modal for a specific job. Threaded from
   *  App.tsx so tapping a job row inside a customer profile opens
   *  the same modal the History page uses. Optional for legacy
   *  call sites; when absent, job rows render non-interactive. */
  onViewJob?: (j: Job) => void;
}

// ─────────────────────────────────────────────────────────────────────
//  Customers — CRM. Two states: a derived list, and an in-page
//  profile drill-down. Every field is computed live from jobs
//  (see lib/customers.ts); the only persisted datum is a free-text
//  operator note at customers/{key}.
//
//  Phase-1 upgrade adds:
//    • Filter chips (All / Repeat / New / Unpaid)
//    • Sort chips (Revenue / Recent / A-Z)
//    • Tap-to-open job from inside the profile
//    • Email compose button when email is on file
//    • Per-customer Avg Job Value + Top Service
// ─────────────────────────────────────────────────────────────────────

type FilterMode = 'all' | 'repeat' | 'new' | 'unpaid';
type SortMode   = 'revenue' | 'recent' | 'name';

export function Customers({ jobs: rawJobs, settings, customerMeta, onViewJob }: Props) {
  const jobs = useScopedJobs(rawJobs);
  const { member, role, permissions } = useMembership();
  const businessId = member?.businessId || null;
  const canEditNote = role === 'owner' || role === 'admin';
  const canViewProfit = permissions.canViewProfit;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('revenue');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Render budget — see History.tsx rationale. Customer cards are
  // taller than job cards (revenue + profit + tags + last-job line)
  // so the cliff hits even sooner. 50 per page, reset on filter
  // change.
  const [renderLimit, setRenderLimit] = useState(50);
  useEffect(() => { setRenderLimit(50); }, [query, filter, tagFilter, sort]);

  const customers = useMemo(
    () => deriveCustomerProfiles(jobs, settings),
    [jobs, settings],
  );

  const selected = useMemo(
    () => customers.find((c) => c.key === selectedKey) || null,
    [customers, selectedKey],
  );

  // ── Tag aggregates ──────────────────────────────────────────────
  // Collect every distinct tag in use, ordered: preset tags first
  // (in their declared order), then any custom tags alphabetically.
  // Counts come from the meta map directly.
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const meta of customerMeta.values()) {
      if (!meta.tags) continue;
      for (const t of meta.tags) counts.set(t, (counts.get(t) || 0) + 1);
    }
    const presetSet = new Set<string>(PRESET_CUSTOMER_TAGS);
    const presetUsed = (PRESET_CUSTOMER_TAGS as readonly string[]).filter((t) => counts.has(t));
    const custom = [...counts.keys()]
      .filter((t) => !presetSet.has(t))
      .sort((a, b) => a.localeCompare(b));
    return [...presetUsed, ...custom].map((t) => ({ tag: t, count: counts.get(t) || 0 }));
  }, [customerMeta]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = customers;
    if (q) {
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) || c.phone.includes(q));
    }
    if (filter === 'repeat') list = list.filter((c) => c.isRepeat);
    if (filter === 'new')    list = list.filter((c) => !c.isRepeat);
    if (filter === 'unpaid') list = list.filter((c) => c.unpaidCount > 0);
    if (tagFilter) {
      list = list.filter((c) => {
        const tags = customerMeta.get(c.key)?.tags;
        return tags ? tags.includes(tagFilter) : false;
      });
    }
    // deriveCustomerProfiles already sorts by revenue desc; only
    // re-sort when the user picked a different axis.
    if (sort === 'recent') {
      list = [...list].sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
    } else if (sort === 'name') {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [customers, query, filter, tagFilter, sort, customerMeta]);

  // ── Profile drill-down ──────────────────────────────────────────
  if (selected) {
    return (
      <CustomerProfileView
        profile={selected}
        meta={customerMeta.get(selected.key) || {}}
        settings={settings}
        businessId={businessId}
        canEditNote={canEditNote}
        canViewProfit={canViewProfit}
        onViewJob={onViewJob}
        onBack={() => setSelectedKey(null)}
      />
    );
  }

  // ── List ────────────────────────────────────────────────────────
  const topThree = customers.slice(0, 3);
  const unpaidCustomerCount = customers.filter((c) => c.unpaidCount > 0).length;
  const repeatCount = customers.filter((c) => c.isRepeat).length;

  // CSV export — operates on the currently-filtered list, so the
  // operator can scope the export by switching the filter / search
  // first (e.g. "all unpaid customers"). Pure helper builds the
  // string; this fn handles only the Blob + download.
  const handleExportCsv = () => {
    if (filtered.length === 0) {
      addToast('Nothing to export with the current filters', 'warn');
      return;
    }
    const csv = customersToCsv(filtered, customerMeta, { includeProfit: canViewProfit });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `customers-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    addToast(`Exported ${filtered.length} customer${filtered.length !== 1 ? 's' : ''}`, 'success');
  };

  return (
    <div className="page page-enter">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Customers</div>
        {customers.length > 0 && (
          <button
            type="button"
            className="btn xs secondary"
            onClick={handleExportCsv}
            title="Download filtered customer list as CSV"
          >
            ↓ CSV
          </button>
        )}
      </div>

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

      {/* Filter chips — total counts surfaced inline so the chip
          itself signals whether tapping it is worth the operator's
          time (e.g. "Unpaid (3)" vs "Unpaid (0)" hidden state). */}
      <div className="chip-grid" style={{ marginBottom: 10 }}>
        <FilterChip active={filter === 'all'}    onClick={() => setFilter('all')}>
          All <Count n={customers.length} />
        </FilterChip>
        <FilterChip active={filter === 'repeat'} onClick={() => setFilter('repeat')}>
          Repeat <Count n={repeatCount} />
        </FilterChip>
        <FilterChip active={filter === 'new'}    onClick={() => setFilter('new')}>
          New <Count n={customers.length - repeatCount} />
        </FilterChip>
        <FilterChip active={filter === 'unpaid'} onClick={() => setFilter('unpaid')} tone={unpaidCustomerCount > 0 ? 'warn' : undefined}>
          Unpaid <Count n={unpaidCustomerCount} />
        </FilterChip>
      </div>

      {/* Tag-filter chip row — only renders when at least one
          customer has a tag persisted. Lets the operator pick a
          single tag to scope the list. Tap the active tag to clear. */}
      {allTags.length > 0 && (
        <div className="chip-grid" style={{ marginBottom: 10 }}>
          {allTags.map(({ tag, count }) => (
            <FilterChip
              key={tag}
              active={tagFilter === tag}
              onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
            >
              {tag} <Count n={count} />
            </FilterChip>
          ))}
        </div>
      )}

      {/* Sort chips */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center',
        fontSize: 11, color: 'var(--t3)', marginBottom: 14,
      }}>
        <span style={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800 }}>Sort</span>
        <SortChip active={sort === 'revenue'} onClick={() => setSort('revenue')}>Revenue</SortChip>
        <SortChip active={sort === 'recent'}  onClick={() => setSort('recent')}>Recent</SortChip>
        <SortChip active={sort === 'name'}    onClick={() => setSort('name')}>A–Z</SortChip>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">👥</div>
          <div className="empty-state-title">
            {query || filter !== 'all' ? 'No customers match' : 'No customers yet'}
          </div>
          <div className="empty-state-sub">
            {query || filter !== 'all'
              ? 'Try clearing the search or switching the filter.'
              : 'Customers appear automatically as you log jobs.'}
          </div>
        </div>
      ) : (
        <div className="stack">
          {filtered.slice(0, renderLimit).map((c) => (
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
                    <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {c.name}
                      {c.isRepeat && <RepeatBadge />}
                      {(customerMeta.get(c.key)?.tags || []).map((t) => (
                        <TagPill key={t}>{t}</TagPill>
                      ))}
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
          {filtered.length > renderLimit && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => setRenderLimit((n) => n + 50)}
              style={{ marginTop: 6 }}
            >
              Load more ({filtered.length - renderLimit} remaining)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Filter / sort chip helpers ────────────────────────────────────

function FilterChip({
  active, onClick, children, tone,
}: { active: boolean; onClick: () => void; children: React.ReactNode; tone?: 'warn' }) {
  return (
    <button
      className={'chip' + (active ? ' active' : '')}
      onClick={onClick}
      type="button"
      style={tone === 'warn' && !active ? {
        borderColor: 'rgba(239,68,68,.35)',
        color: '#ef4444',
      } : undefined}
    >
      {children}
    </button>
  );
}

function SortChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? 'var(--s1)' : 'transparent',
        border: active ? '1px solid var(--border2)' : '1px solid var(--border)',
        color: active ? 'var(--t1)' : 'var(--t3)',
        borderRadius: 999, padding: '3px 9px',
        fontSize: 11, fontWeight: 700, cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>
      {n}
    </span>
  );
}

// ─── Tag pill — compact label shown on the row + profile header ───
function TagPill({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: 0.3, textTransform: 'uppercase',
      color: 'var(--t1)', background: 'var(--s3)',
      border: '1px solid var(--border)', borderRadius: 999, padding: '2px 7px',
    }}>
      {children}
    </span>
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
  profile, meta, settings, businessId, canEditNote, canViewProfit, onBack, onViewJob,
}: {
  profile: CustomerProfile;
  meta: CustomerMeta;
  settings: Settings;
  businessId: string | null;
  canEditNote: boolean;
  canViewProfit: boolean;
  onBack: () => void;
  onViewJob?: (j: Job) => void;
}) {
  const phoneDigits = profile.phone.replace(/\D/g, '');

  // Per-customer derived stats — cheap to compute live, no caching.
  // avgJobValue is revenue ÷ jobs. topService picks the service the
  // customer has booked most often (ties broken by first occurrence).
  const avgJobValue = profile.jobCount > 0
    ? profile.revenue / profile.jobCount
    : 0;
  const topService = useMemo(() => {
    const counts = new Map<string, number>();
    for (const j of profile.jobs) {
      const s = (j.service || '').trim();
      if (!s) continue;
      counts.set(s, (counts.get(s) || 0) + 1);
    }
    let best: { service: string; count: number } | null = null;
    for (const [service, count] of counts) {
      if (!best || count > best.count) best = { service, count };
    }
    return best;
  }, [profile.jobs]);

  // ── Editable operator note + tags ────────────────────────────────
  // Both persist to the same customers/{key} doc; tags are added as
  // a new array field alongside the existing note. Reads come from
  // the App-level subscription (props.meta) so there's no per-profile
  // Firestore fetch any more.
  const [note, setNote] = useState(meta.note || '');
  const [noteDirty, setNoteDirty] = useState(false);
  const [tags, setTags] = useState<string[]>(meta.tags || []);
  const [savingNote, setSavingNote] = useState(false);
  const [savingTags, setSavingTags] = useState(false);
  const [customTagDraft, setCustomTagDraft] = useState('');

  const writeDoc = async (patch: { note?: string; tags?: string[] }) => {
    const col = businessId ? scopedCol(businessId, 'customers') : null;
    if (!col) return;
    await fbSet(col, profile.key, {
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      updatedAt: new Date().toISOString(),
    });
  };

  const saveNote = async () => {
    setSavingNote(true);
    try {
      await writeDoc({ note: note.trim() });
      setNoteDirty(false);
      addToast('Note saved', 'success');
    } catch {
      addToast('Could not save note', 'error');
    } finally {
      setSavingNote(false);
    }
  };

  const persistTags = async (next: string[]) => {
    setSavingTags(true);
    try {
      await writeDoc({ tags: next });
    } catch {
      addToast('Could not save tags', 'error');
      // Roll back local state on persistence failure so the UI
      // stays consistent with what's actually saved.
      setTags(meta.tags || []);
    } finally {
      setSavingTags(false);
    }
  };

  const toggleTag = (tag: string) => {
    const set = new Set(tags);
    if (set.has(tag)) set.delete(tag); else set.add(tag);
    const next = [...set].sort();
    setTags(next);
    void persistTags(next);
  };

  const addCustomTag = () => {
    const t = customTagDraft.trim();
    if (!t) return;
    if (tags.includes(t)) { setCustomTagDraft(''); return; }
    const next = [...tags, t].sort();
    setTags(next);
    setCustomTagDraft('');
    void persistTags(next);
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>{profile.name}</div>
        {profile.isRepeat && <RepeatBadge />}
        {tags.map((t) => <TagPill key={t}>{t}</TagPill>)}
      </div>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 14 }}>
        {profile.phone || 'No phone on file'}
        {profile.email ? ` · ${profile.email}` : ''}
      </div>

      {/* Contact action buttons — call / text / email rendered only
          when the corresponding data is on file. Email button is
          new in Phase 1: tells the operator the email is reachable
          and opens the OS mail composer with the customer's
          address pre-filled. Subject defaults to the business name
          so the email lands in their inbox with a clear sender
          context, not "no subject". */}
      {(phoneDigits || profile.email) && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {phoneDigits && (
            <a className="btn sm secondary" href={`tel:${phoneDigits}`} style={{ flex: 1, minWidth: 90, textAlign: 'center' }}>📞 Call</a>
          )}
          {phoneDigits && (
            <a className="btn sm secondary" href={`sms:${phoneDigits}`} style={{ flex: 1, minWidth: 90, textAlign: 'center' }}>💬 Text</a>
          )}
          {profile.email && (
            <a
              className="btn sm secondary"
              href={`mailto:${profile.email}`}
              style={{ flex: 1, minWidth: 90, textAlign: 'center' }}
            >
              ✉ Email
            </a>
          )}
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
          <Stat label="Avg / job" value={money(avgJobValue)} />
          <Stat label="Reviews sent" value={String(profile.reviewsSent)} />
          <Stat label="First seen" value={profile.firstDate ? fmtDate(profile.firstDate) : '—'} />
          <Stat label="Last seen" value={profile.lastDate ? fmtDate(profile.lastDate) : '—'} />
          {profile.visitCadenceDays != null && (
            <Stat
              label="Visits"
              value={`Every ${Math.round(profile.visitCadenceDays)} days`}
            />
          )}
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

      {/* Tags (Phase 2) — preset chips toggle on/off + free-text add.
          Owner/admin only; technicians see the tags but can't edit. */}
      {canEditNote && (
        <div className="form-group">
          <div className="form-group-title">
            Tags {savingTags ? <span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 6 }}>saving…</span> : null}
          </div>
          <div className="chip-grid" style={{ marginBottom: 10 }}>
            {(PRESET_CUSTOMER_TAGS as readonly string[]).map((t) => (
              <button
                key={t}
                type="button"
                className={'chip' + (tags.includes(t) ? ' active' : '')}
                onClick={() => toggleTag(t)}
              >
                {t}
              </button>
            ))}
            {tags.filter((t) => !(PRESET_CUSTOMER_TAGS as readonly string[]).includes(t)).map((t) => (
              <button
                key={t}
                type="button"
                className={'chip active'}
                onClick={() => toggleTag(t)}
                title="Remove this tag"
              >
                {t} ×
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={customTagDraft}
              onChange={(e) => setCustomTagDraft(e.target.value)}
              placeholder="Add custom tag…"
              onKeyDown={(e) => { if (e.key === 'Enter') addCustomTag(); }}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn sm secondary"
              onClick={addCustomTag}
              disabled={!customTagDraft.trim()}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Vehicles / tire sizes — whichever the customer's jobs carry. */}
      {(profile.vehicles.length > 0 || profile.tireSizes.length > 0 || profile.paymentMethods.length > 0 || topService) && (
        <div className="form-group">
          <div className="form-group-title">History</div>
          {topService && (
            <Row
              label="Top service"
              value={`${topService.service} (${topService.count}×)`}
            />
          )}
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

      {/* Payment-method mix bar (Phase 3) — only renders when the
          customer has paid more than once (a one-job customer's
          single method is already in the History row above). Shows
          a single horizontal stacked bar with percent labels per
          method. Color palette uses brand tones for stability. */}
      {profile.jobCount > 1 && Object.keys(profile.paymentMethodCounts).length > 0 && (
        <div className="form-group">
          <div className="form-group-title">Payment mix</div>
          <PaymentMixBar counts={profile.paymentMethodCounts} />
        </div>
      )}

      {/* Operator note */}
      <div className="form-group">
        <div className="form-group-title">Notes</div>
        {canEditNote ? (
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

      {/* Job history — each row is now tappable when onViewJob is
          threaded from the parent (App.tsx). Falls back to a non-
          interactive card if not, so this component is still
          rendered correctly in any legacy context. */}
      <div className="section-label">Job History</div>
      <div className="stack">
        {profile.jobs.map((j) => {
          const ps = resolvePaymentStatus(j);
          const tappable = !!onViewJob;
          const content = (
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
          );
          return tappable ? (
            <button
              key={j.id}
              type="button"
              onClick={() => onViewJob && onViewJob(j)}
              className="card card-anim press-scale"
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                color: 'var(--t1)', cursor: 'pointer', padding: 0,
              }}
            >
              {content}
            </button>
          ) : (
            <div key={j.id} className="card">{content}</div>
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

// Horizontal stacked bar showing how the customer pays. Colors rotate
// through a fixed palette so the SAME method gets the SAME color
// across customer profiles (cash → green, card → gold, etc.).
const PAYMENT_COLORS: Record<string, string> = {
  cash:    '#22c55e',
  card:    'var(--brand-primary)',
  zelle:   '#3b82f6',
  venmo:   '#8b5cf6',
  cashapp: '#10b981',
  check:   '#64748b',
};
const FALLBACK_COLOR = 'var(--t3)';

function PaymentMixBar({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, c]) => s + c, 0);
  if (total === 0) return null;
  return (
    <>
      <div style={{
        display: 'flex', height: 14, borderRadius: 8, overflow: 'hidden',
        border: '1px solid var(--border)',
      }}>
        {entries.map(([method, count]) => (
          <div
            key={method}
            title={`${PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS] ?? method}: ${count}`}
            style={{
              width: `${(count / total) * 100}%`,
              background: PAYMENT_COLORS[method] || FALLBACK_COLOR,
            }}
          />
        ))}
      </div>
      <div style={{
        marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8,
        fontSize: 11, color: 'var(--t2)',
      }}>
        {entries.map(([method, count]) => (
          <span key={method} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: 2,
              background: PAYMENT_COLORS[method] || FALLBACK_COLOR,
            }} />
            <span>{PAYMENT_METHOD_LABELS[method as keyof typeof PAYMENT_METHOD_LABELS] ?? method}</span>
            <span style={{ color: 'var(--t3)' }}>{Math.round((count / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </>
  );
}
