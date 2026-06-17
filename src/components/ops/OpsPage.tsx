// src/components/ops/OpsPage.tsx
// ═══════════════════════════════════════════════════════════════════
//  AI Ops — the in-app surface for the three loops.
//
//  • Daily brief (read-only): deterministic KPIs render immediately; the
//    AI narrative is generated on demand.
//  • Reorder recommendations (read-only): ranked candidates render from
//    the existing inventory intelligence; the AI adds buy qty + reason.
//  • Review reply (draft): drafts a house-style reply. USING the reply is
//    a gated, side-effecting action — it routes through runAction and is
//    refused until the owner approves. Replies are never auto-posted.
//
//  All Anthropic calls go through the server (callAiOps); the API key
//  never reaches the client. Model output is always safe-parsed before
//  render. Styling reuses the app's dark design system (.card / .kpi /
//  .field / brand tokens) — no bespoke light surfaces.
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState, type CSSProperties } from 'react';
import type { Job, InventoryItem, Settings } from '@/types';
import { useBrand } from '@/context/BrandContext';
import { resolveBrandDefaults } from '@/lib/defaults';
import { money } from '@/lib/utils';
import { sizeKey } from '@/lib/inventoryIntel';
import {
  callAiOps,
  runAction,
  ApprovalRequiredError,
  OPS_LOOPS,
  validateReviewReply,
  describeViolation,
  gatherReorderContext,
  buildReorderPrompt,
  parseReorderResult,
  type ReorderContextItem,
  type ReorderRecommendation,
  gatherReviewContext,
  buildReviewPrompt,
  parseReviewResult,
  gatherBriefContext,
  buildBriefPrompt,
  parseBriefResult,
  type DailyBrief,
  type ParseResult,
} from '@/lib/ops';

interface Props {
  jobs: Job[];
  inventory: InventoryItem[];
  settings: Settings;
}

function humanizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('AI_NOT_CONFIGURED')) {
    return 'AI is not configured yet. Add the ANTHROPIC_API_KEY secret to enable it (see docs/ai-ops-layer.md).';
  }
  if (msg.includes('permission-denied') || msg.includes('owner or admin')) {
    return 'Only the owner or an admin can use AI Ops.';
  }
  if (msg.includes('unauthenticated')) return 'Please sign in again.';
  return msg || 'Something went wrong.';
}

const subtle: CSSProperties = { color: 'var(--t3)', fontSize: 12, lineHeight: 1.45 };
const cardHead: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 12,
};
const rowBox: CSSProperties = {
  background: 'var(--s2)', border: '1px solid var(--border2)', borderRadius: 10, padding: '10px 12px',
};

export function OpsPage({ jobs, inventory, settings }: Props): JSX.Element {
  const { brand, businessId } = useBrand();
  const businessName = resolveBrandDefaults(brand).businessName || 'Mobile Service OS';

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 2 }}>AI Ops</div>
      <p style={{ ...subtle, marginTop: 0, marginBottom: 16 }}>
        Claude turns your data into recommendations and drafts. Nothing acts on its own — anything that
        sends or spends needs your approval first.
      </p>

      {!businessId && (
        <div className="card card-pad" style={{ marginBottom: 14 }}>
          <span style={subtle}>Sign in to use AI Ops.</span>
        </div>
      )}

      {/* Brief + Reorder sit side by side on desktop (.cols-lg, ≥1024px),
          stacked on phone. Review is full width below. */}
      <div className="cols-lg">
        <BriefCard jobs={jobs} inventory={inventory} settings={settings} businessName={businessName} businessId={businessId} />
        <ReorderCard jobs={jobs} inventory={inventory} businessName={businessName} businessId={businessId} />
      </div>
      <ReviewCard businessName={businessName} businessId={businessId} />
    </div>
  );
}

// ───────────────────────────── shared runner ─────────────────────────

async function runLoop<T>(args: {
  businessId: string;
  loopId: 'reorder' | 'review' | 'brief';
  system: string;
  user: string;
  parse: (raw: string) => ParseResult<T>;
}): Promise<ParseResult<T>> {
  try {
    const raw = await callAiOps({
      businessId: args.businessId,
      loopId: args.loopId,
      system: args.system,
      user: args.user,
    });
    return args.parse(raw);
  } catch (e) {
    return { ok: false, error: humanizeError(e) };
  }
}

function RunButton({ label, busy, disabled, onClick }: { label: string; busy: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn primary sm" disabled={busy || disabled} onClick={onClick} style={{ flexShrink: 0 }}>
      {busy ? 'Working…' : label}
    </button>
  );
}

function ErrorLine({ msg }: { msg: string }) {
  return <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 10 }}>{msg}</div>;
}

// ───────────────────────────── Daily brief ───────────────────────────

function BriefCard({
  jobs, inventory, settings, businessName, businessId,
}: { jobs: Job[]; inventory: InventoryItem[]; settings: Settings; businessName: string; businessId: string | null }) {
  void settings;
  const ctx = useMemo(() => gatherBriefContext(jobs, inventory), [jobs, inventory]);
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [error, setError] = useState('');

  const generate = async () => {
    if (!businessId) return;
    setBusy(true); setError(''); setBrief(null);
    const { system, user } = buildBriefPrompt(ctx, businessName);
    const res = await runLoop({ businessId, loopId: 'brief', system, user, parse: parseBriefResult });
    if (res.ok) setBrief(res.value);
    else setError(res.error);
    setBusy(false);
  };

  const kpi = (label: string, value: string): JSX.Element => (
    <div className="kpi"><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div></div>
  );

  return (
    <div className="card card-pad" style={{ marginBottom: 14 }}>
      <div style={cardHead}>
        <div>
          <strong style={{ fontSize: 14 }}>{OPS_LOOPS.brief.title}</strong>
          <div style={{ ...subtle, marginTop: 2 }}>Today and this week at a glance.</div>
        </div>
        <RunButton label="Generate brief" busy={busy} disabled={!businessId} onClick={generate} />
      </div>

      {/* Deterministic KPIs render immediately — read-only, no approval needed. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        {kpi('Jobs today', String(ctx.todayJobs))}
        {kpi('Revenue today', money(ctx.todayRevenue))}
        {kpi('Jobs this week', String(ctx.weekJobs))}
        {kpi('Profit this week', money(ctx.weekProfit))}
      </div>
      <div style={{ ...subtle, color: 'var(--t2)' }}>
        <strong>{ctx.pendingPayments.count}</strong> unpaid {ctx.pendingPayments.count === 1 ? 'invoice' : 'invoices'} ·{' '}
        <strong>{money(ctx.pendingPayments.total)}</strong> outstanding
        {ctx.reorderFlags.length > 0 && <> · <strong style={{ color: 'var(--amber)' }}>{ctx.reorderFlags.length}</strong> reorder {ctx.reorderFlags.length === 1 ? 'flag' : 'flags'}</>}
      </div>

      {brief && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border2)' }}>
          {brief.headline && <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{brief.headline}</div>}
          {brief.summary && <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 10, color: 'var(--t2)' }}>{brief.summary}</div>}
          {brief.mostImportant && (
            <div style={{ background: 'var(--brand-primary-dim)', border: '1px solid rgba(200,164,74,.28)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 800, marginBottom: 3, color: 'var(--brand-primary)' }}>Most important today</div>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--t1)' }}>{brief.mostImportant}</div>
            </div>
          )}
        </div>
      )}
      {error && <ErrorLine msg={error} />}
    </div>
  );
}

// ──────────────────────────── Reorder picks ──────────────────────────

function ReorderCard({
  jobs, inventory, businessName, businessId,
}: { jobs: Job[]; inventory: InventoryItem[]; businessName: string; businessId: string | null }) {
  const ctx = useMemo(() => gatherReorderContext(jobs, inventory), [jobs, inventory]);
  const [busy, setBusy] = useState(false);
  const [recs, setRecs] = useState<ReorderRecommendation[] | null>(null);
  const [error, setError] = useState('');

  const byKey = useMemo(() => {
    const m = new Map<string, ReorderContextItem>();
    for (const it of ctx.items) m.set(sizeKey(it.size), it);
    return m;
  }, [ctx]);

  const generate = async () => {
    if (!businessId) return;
    setBusy(true); setError(''); setRecs(null);
    const { system, user } = buildReorderPrompt(ctx, businessName);
    const res = await runLoop({ businessId, loopId: 'reorder', system, user, parse: parseReorderResult });
    if (res.ok) setRecs(res.value.recommendations);
    else setError(res.error);
    setBusy(false);
  };

  const dot = (out: boolean): JSX.Element => (
    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: out ? 'var(--red)' : 'var(--green)', marginRight: 6, verticalAlign: 'middle' }} />
  );

  return (
    <div className="card card-pad" style={{ marginBottom: 14 }}>
      <div style={cardHead}>
        <div>
          <strong style={{ fontSize: 14 }}>{OPS_LOOPS.reorder.title}</strong>
          <div style={{ ...subtle, marginTop: 2 }}>
            Last {ctx.windowDays} days · {ctx.items.length} candidate{ctx.items.length !== 1 ? 's' : ''} · out of stock and most called for first.
          </div>
        </div>
        <RunButton label="Generate picks" busy={busy} disabled={!businessId || ctx.items.length === 0} onClick={generate} />
      </div>

      {ctx.items.length === 0 && <div style={subtle}>No reorder candidates yet — log a few completed jobs first.</div>}

      {recs ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recs.map((r, i) => {
              const c = byKey.get(sizeKey(r.size));
              return (
                <div key={`${r.size}-${i}`} style={rowBox}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>{r.size}</span>
                    <span style={{ color: 'var(--brand-primary)', fontWeight: 800, fontSize: 12, whiteSpace: 'nowrap' }}>Buy {r.suggestedBuyQty}</span>
                  </div>
                  {r.reason && <div style={{ fontSize: 12, margin: '4px 0 0', color: 'var(--t2)', lineHeight: 1.5 }}>{r.reason}</div>}
                  {c && (
                    <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 5 }}>
                      {dot(c.outOfStock)}
                      {c.outOfStock ? 'Out of stock' : `${c.onHand} on hand`} · {c.jobsInWindow} {c.jobsInWindow === 1 ? 'job' : 'jobs'}/{ctx.windowDays}d · avg {money(c.avgPerTire)}/tire
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ ...subtle, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border2)' }}>
            Recommendations only — you place orders in your supplier's system.
          </div>
        </>
      ) : (
        ctx.items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ctx.items.slice(0, 5).map((c) => (
              <div key={c.size} style={{ ...rowBox, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{c.size}</span>
                <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                  {dot(c.outOfStock)}{c.outOfStock ? 'Out of stock' : `${c.onHand} in stock`} · {c.jobsInWindow} jobs
                </span>
              </div>
            ))}
            <div style={{ ...subtle, marginTop: 2 }}>Tap “Generate picks” for buy quantities and reasons.</div>
          </div>
        )
      )}
      {error && <ErrorLine msg={error} />}
    </div>
  );
}

// ───────────────────────────── Review reply ──────────────────────────

function ReviewCard({ businessName, businessId }: { businessName: string; businessId: string | null }) {
  const sendAction = OPS_LOOPS.review.actions[0]; // review.send — gated
  const [text, setText] = useState('');
  const [reviewerName, setReviewerName] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [approved, setApproved] = useState(false);
  const [sendStatus, setSendStatus] = useState('');

  const violations = useMemo(() => (draft ? validateReviewReply(draft).violations : []), [draft]);

  const generate = async () => {
    if (!businessId || !text.trim()) return;
    setBusy(true); setError(''); setDraft(''); setApproved(false); setSendStatus('');
    const ctx = gatherReviewContext({ text, reviewerName }, businessName);
    const { system, user } = buildReviewPrompt(ctx);
    const res = await runLoop({ businessId, loopId: 'review', system, user, parse: parseReviewResult });
    if (res.ok) setDraft(res.value.reply);
    else setError(res.error);
    setBusy(false);
  };

  // The gated, side-effecting action. runAction REFUSES to run unless
  // approved — the hard approval gate, enforced by the flag not the UI.
  const useReply = async () => {
    setSendStatus('');
    try {
      await runAction(sendAction, { approved }, async () => {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(draft);
        }
      });
      setSendStatus('Approved reply copied. Paste it into your Google review response.');
    } catch (e) {
      if (e instanceof ApprovalRequiredError) setSendStatus('Approve the reply before using it.');
      else setSendStatus('Could not copy the reply.');
    }
  };

  return (
    <div className="card card-pad">
      <div style={cardHead}>
        <div>
          <strong style={{ fontSize: 14 }}>{OPS_LOOPS.review.title}</strong>
          <div style={{ ...subtle, marginTop: 2 }}>
            Paste a Google review — Claude drafts a house-style reply. You approve and use it; it is never auto-posted.
          </div>
        </div>
        <span style={{
          fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
          color: 'var(--brand-primary)', background: 'var(--brand-primary-dim)',
          border: '1px solid rgba(200,164,74,.28)', borderRadius: 99, padding: '2px 7px', whiteSpace: 'nowrap',
        }}>Needs approval</span>
      </div>

      <div className="field" style={{ marginBottom: 8 }}>
        <input
          placeholder="Reviewer name (optional)"
          value={reviewerName}
          onChange={(e) => setReviewerName(e.target.value)}
        />
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <textarea
          placeholder="Paste the review text here…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          style={{ resize: 'vertical' }}
        />
      </div>
      <RunButton label="Draft reply" busy={busy} disabled={!businessId || !text.trim()} onClick={generate} />

      {draft && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border2)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--t2)' }}>Draft response</div>
          <div className="field" style={{ marginBottom: 10 }}>
            <textarea
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setApproved(false); setSendStatus(''); }}
              rows={5}
              style={{ resize: 'vertical' }}
            />
          </div>

          {violations.length > 0 ? (
            <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 10, padding: '9px 11px', marginBottom: 10 }}>
              <div style={{ color: 'var(--amber)', fontSize: 11, fontWeight: 800, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>House-style issues</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>
                {violations.map((v) => <li key={v}>{describeViolation(v)}</li>)}
              </ul>
            </div>
          ) : (
            <div style={{ background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.3)', borderRadius: 10, padding: '9px 11px', marginBottom: 10 }}>
              <div style={{ color: 'var(--green)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>Meets house style</div>
            </div>
          )}

          {/* Approval gate for the side-effecting "use this reply" action. */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={approved} onChange={(e) => { setApproved(e.target.checked); setSendStatus(''); }} style={{ cursor: 'pointer', width: 16, height: 16 }} />
            <span>I approve this reply</span>
          </label>
          <button
            type="button"
            className="btn primary"
            disabled={!approved || violations.length > 0}
            onClick={useReply}
            style={{ width: '100%' }}
          >
            {approved ? sendAction.label : 'Approve to use'}
          </button>
          {sendStatus && (
            <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 10, padding: '8px 10px', background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.25)', borderRadius: 8 }}>
              {sendStatus}
            </div>
          )}
        </div>
      )}
      {error && <ErrorLine msg={error} />}
    </div>
  );
}
