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
//  render.
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

const cardStyle: CSSProperties = { marginBottom: 14 };
const subtle: CSSProperties = { color: 'var(--t3)', fontSize: 12 };

export function OpsPage({ jobs, inventory, settings }: Props): JSX.Element {
  const { brand, businessId } = useBrand();
  const businessName = resolveBrandDefaults(brand).businessName || 'Mobile Service OS';

  return (
    <div className="page page-enter">
      <div className="section-label" style={{ marginTop: 4 }}>AI Ops</div>
      <p style={{ ...subtle, marginTop: -4, marginBottom: 14 }}>
        Claude turns your data into recommendations and drafts. Nothing acts on its own — anything that
        sends or spends needs your approval first.
      </p>

      {!businessId && (
        <div className="card card-pad" style={cardStyle}>
          <span style={subtle}>Sign in to use AI Ops.</span>
        </div>
      )}

      <BriefCard jobs={jobs} inventory={inventory} settings={settings} businessName={businessName} businessId={businessId} />
      <ReorderCard jobs={jobs} inventory={inventory} businessName={businessName} businessId={businessId} />
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
    <button type="button" className="btn primary sm" disabled={busy || disabled} onClick={onClick}>
      {busy ? 'Working…' : label}
    </button>
  );
}

function ErrorLine({ msg }: { msg: string }) {
  return <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{msg}</div>;
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
    <div className="card card-pad" style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <strong>{OPS_LOOPS.brief.title}</strong>
        <RunButton label="Generate brief" busy={busy} disabled={!businessId} onClick={generate} />
      </div>

      {/* Deterministic KPIs render immediately — read-only, no approval needed. */}
      <div className="kpi-grid">
        {kpi('Jobs today', String(ctx.todayJobs))}
        {kpi('Revenue today', money(ctx.todayRevenue))}
        {kpi('Jobs this week', String(ctx.weekJobs))}
        {kpi('Profit this week', money(ctx.weekProfit))}
      </div>
      <div style={subtle}>
        {ctx.pendingPayments.count} unpaid {ctx.pendingPayments.count === 1 ? 'invoice' : 'invoices'} ·
        {' '}{money(ctx.pendingPayments.total)} outstanding
        {ctx.reorderFlags.length > 0 && <> · {ctx.reorderFlags.length} reorder {ctx.reorderFlags.length === 1 ? 'flag' : 'flags'}</>}
      </div>

      {brief && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border2)', paddingTop: 12 }}>
          {brief.headline && <div style={{ fontWeight: 700, marginBottom: 6 }}>{brief.headline}</div>}
          {brief.summary && <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>{brief.summary}</div>}
          {brief.mostImportant && (
            <div style={{ background: 'var(--brand-primary-dim)', border: '1px solid var(--border2)', borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ ...subtle, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, marginBottom: 2 }}>Most important today</div>
              <div style={{ fontSize: 13 }}>{brief.mostImportant}</div>
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

  return (
    <div className="card card-pad" style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <strong>{OPS_LOOPS.reorder.title}</strong>
        <RunButton label="Generate picks" busy={busy} disabled={!businessId || ctx.items.length === 0} onClick={generate} />
      </div>
      <div style={{ ...subtle, marginBottom: 10 }}>
        Last {ctx.windowDays} days · {ctx.items.length} candidate {ctx.items.length === 1 ? 'size' : 'sizes'} · out-of-stock and most-called-for first
      </div>

      {ctx.items.length === 0 && <div style={subtle}>No reorder candidates yet — log a few completed jobs first.</div>}

      {recs ? (
        <div>
          {recs.map((r, i) => {
            const c = byKey.get(sizeKey(r.size));
            return (
              <div key={`${r.size}-${i}`} style={{ borderTop: '1px solid var(--border2)', padding: '10px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontWeight: 700 }}>{r.size}</span>
                  <span style={{ color: 'var(--brand-primary)', fontWeight: 700, fontSize: 13 }}>Buy {r.suggestedBuyQty}</span>
                </div>
                {r.reason && <div style={{ fontSize: 12, margin: '4px 0' }}>{r.reason}</div>}
                {c && (
                  <div style={subtle}>
                    {c.outOfStock ? 'Out of stock' : `${c.onHand} on hand`} · {c.jobsInWindow} {c.jobsInWindow === 1 ? 'job' : 'jobs'}/{ctx.windowDays}d · avg {money(c.avgPerTire)}/tire
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ ...subtle, marginTop: 8 }}>Recommendation only — you place the order.</div>
        </div>
      ) : (
        // Candidate preview (deterministic, read-only) before AI runs.
        ctx.items.length > 0 && (
          <div>
            {ctx.items.slice(0, 5).map((c) => (
              <div key={c.size} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderTop: '1px solid var(--border2)', fontSize: 13 }}>
                <span>{c.size}</span>
                <span style={subtle}>{c.outOfStock ? 'Out of stock' : `${c.onHand} on hand`} · {c.jobsInWindow} jobs</span>
              </div>
            ))}
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
    <div className="card card-pad" style={cardStyle}>
      <div style={{ marginBottom: 8 }}><strong>{OPS_LOOPS.review.title}</strong></div>
      <div style={{ ...subtle, marginBottom: 10 }}>Paste a Google review. Claude drafts a house-style reply. You approve and send — never auto-posted.</div>

      <input
        className="input"
        placeholder="Reviewer name (optional)"
        value={reviewerName}
        onChange={(e) => setReviewerName(e.target.value)}
        style={{ width: '100%', marginBottom: 8 }}
      />
      <textarea
        className="input"
        placeholder="Paste the review text here…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        style={{ width: '100%', marginBottom: 8, resize: 'vertical' }}
      />
      <RunButton label="Draft reply" busy={busy} disabled={!businessId || !text.trim()} onClick={generate} />

      {draft && (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...subtle, marginBottom: 4 }}>Draft (edit before approving):</div>
          <textarea
            className="input"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setApproved(false); setSendStatus(''); }}
            rows={5}
            style={{ width: '100%', resize: 'vertical' }}
          />

          {violations.length > 0 ? (
            <div style={{ marginTop: 8, color: 'var(--amber)', fontSize: 12 }}>
              House-style issues to fix:
              <ul style={{ margin: '4px 0 0 16px' }}>
                {violations.map((v) => <li key={v}>{describeViolation(v)}</li>)}
              </ul>
            </div>
          ) : (
            <div style={{ marginTop: 8, color: 'var(--green)', fontSize: 12 }}>Meets house style ✓</div>
          )}

          {/* Approval gate for the side-effecting "use this reply" action. */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={approved} onChange={(e) => { setApproved(e.target.checked); setSendStatus(''); }} />
            I approve this reply for sending
          </label>
          <button
            type="button"
            className="btn sm"
            style={{ marginTop: 8 }}
            disabled={!approved}
            onClick={useReply}
          >
            {sendAction.label}
          </button>
          {sendStatus && <div style={{ ...subtle, marginTop: 8 }}>{sendStatus}</div>}
        </div>
      )}
      {error && <ErrorLine msg={error} />}
    </div>
  );
}
