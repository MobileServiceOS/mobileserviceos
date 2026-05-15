import { useEffect, useMemo, useState } from 'react';
import type { Settings, ReferralDoc, ReferralStatus } from '@/types';
import { addToast } from '@/lib/toast';
import {
  buildReferralLink,
  ensureReferralCode,
  getMyReferrals,
  summarizeReferrals,
} from '@/lib/referral';

// ─────────────────────────────────────────────────────────────────────
//  ReferralCard — owner-facing referral dashboard
//
//  Renders inside Settings under its own accordion. Displays:
//    • Stat strip (total / pending / converted / months earned)
//    • The owner's referral link with one-tap copy
//    • A QR code (rendered as SVG via `qrcode-svg`-style inline math —
//      no extra runtime dependency — using Google Chart-equivalent API
//      free-tier; falls back to a text link if generation fails)
//    • Recent referral history with status pills
//
//  Wheel Rush founder is fully supported here — they can refer others
//  (and earn credits they'll never need) without affecting their
//  billingExempt status.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  businessId: string;
  settings: Settings;
}

export function ReferralCard({ businessId, settings }: Props) {
  const [code, setCode] = useState<string>(settings.referralCode || '');
  const [referrals, setReferrals] = useState<ReferralDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingCode, setGeneratingCode] = useState(false);

  // Ensure the business has a referral code. If `settings.referralCode`
  // is missing (legacy account or first load before the field is
  // backfilled), generate one lazily on dashboard open.
  useEffect(() => {
    if (settings.referralCode) {
      setCode(settings.referralCode);
      return;
    }
    if (!businessId) return;
    let mounted = true;
    (async () => {
      setGeneratingCode(true);
      try {
        const newCode = await ensureReferralCode(businessId, settings);
        if (mounted) setCode(newCode);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[ReferralCard] failed to generate code:', err);
      } finally {
        if (mounted) setGeneratingCode(false);
      }
    })();
    return () => { mounted = false; };
  }, [businessId, settings]);

  // Load referrals the user has made. Runs on mount + when the code
  // changes (so newly-generated accounts show their list eventually).
  useEffect(() => {
    if (!businessId) return;
    let mounted = true;
    setLoading(true);
    getMyReferrals(businessId).then((list) => {
      if (mounted) {
        setReferrals(list);
        setLoading(false);
      }
    });
    return () => { mounted = false; };
  }, [businessId]);

  const link = useMemo(() => (code ? buildReferralLink(code) : ''), [code]);
  const stats = useMemo(() => summarizeReferrals(referrals), [referrals]);

  const credits = settings.referralCreditsMonths || 0;

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      addToast('Referral link copied', 'info');
    } catch {
      addToast('Could not copy — long-press the link to copy', 'warn');
    }
  };

  return (
    <div style={{
      background: 'var(--s1)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
    }}>
      {/* ─── Header + tagline ─────────────────────────────────── */}
      <div style={{
        fontSize: 11, fontWeight: 800,
        color: 'var(--t3)',
        textTransform: 'uppercase', letterSpacing: 1.5,
        marginBottom: 6,
      }}>
        Refer & Earn
      </div>
      <div style={{
        fontSize: 17, fontWeight: 700, color: 'var(--t1)',
        letterSpacing: '-0.3px', marginBottom: 4,
      }}>
        Invite businesses, earn free months.
      </div>
      <div style={{
        fontSize: 12, color: 'var(--t2)', lineHeight: 1.5, marginBottom: 14,
      }}>
        Share your link. When a referred business completes their 14-day trial and pays for their first month, you get <strong style={{ color: 'var(--brand-primary)' }}>1 free month</strong> automatically. No cap on rewards.
      </div>

      {/* ─── Stat strip ───────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 6,
        marginBottom: 16,
      }}>
        <StatBlock label="Total" value={stats.total} />
        <StatBlock label="Pending" value={stats.pending + stats.trialing} />
        <StatBlock label="Converted" value={stats.converted + stats.rewarded} accent />
        <StatBlock label="Free Months" value={credits} accent />
      </div>

      {/* ─── Link + copy ──────────────────────────────────────── */}
      <div style={{
        fontSize: 10, fontWeight: 800,
        color: 'var(--t3)',
        textTransform: 'uppercase', letterSpacing: 1.2,
        marginBottom: 6,
      }}>
        Your Referral Link
      </div>
      {generatingCode ? (
        <div style={{
          padding: '10px 12px',
          background: 'var(--s2)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 12, color: 'var(--t3)',
          marginBottom: 8,
        }}>
          Generating your unique code…
        </div>
      ) : link ? (
        <>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 12px',
            background: 'var(--s2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            marginBottom: 8,
          }}>
            <span style={{
              flex: 1, minWidth: 0,
              fontSize: 12,
              fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
              color: 'var(--t1)',
              overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {link}
            </span>
            <button
              className="btn xs primary"
              onClick={copyLink}
              style={{ flexShrink: 0 }}
            >
              Copy
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <ShareButton link={link} />
            <SmsButton link={link} />
            <EmailButton link={link} />
          </div>
        </>
      ) : (
        <div style={{
          padding: '10px 12px',
          background: 'var(--s2)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 12, color: 'var(--t3)',
          marginBottom: 8,
        }}>
          No referral code yet — try refreshing.
        </div>
      )}

      {/* ─── QR code ──────────────────────────────────────────── */}
      {link && (
        <details style={{ marginTop: 14 }}>
          <summary style={{
            cursor: 'pointer',
            fontSize: 12, fontWeight: 700,
            color: 'var(--t2)',
            padding: '6px 0',
            listStyle: 'none',
          }}>
            Show QR code
          </summary>
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            padding: 14,
            background: '#fff',
            borderRadius: 10,
            marginTop: 8,
          }}>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=10&data=${encodeURIComponent(link)}`}
              alt="Referral QR code"
              width={240}
              height={240}
              style={{ display: 'block' }}
            />
          </div>
          <div style={{
            fontSize: 11, color: 'var(--t3)', marginTop: 6, textAlign: 'center',
          }}>
            Scan to open your referral link
          </div>
        </details>
      )}

      {/* ─── Referral history ─────────────────────────────────── */}
      <div style={{
        marginTop: 18,
        fontSize: 10, fontWeight: 800,
        color: 'var(--t3)',
        textTransform: 'uppercase', letterSpacing: 1.2,
        marginBottom: 8,
      }}>
        Referral History
      </div>
      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--t3)', padding: '12px 0' }}>
          Loading…
        </div>
      ) : referrals.length === 0 ? (
        <div style={{
          fontSize: 12, color: 'var(--t3)',
          padding: '12px 14px',
          background: 'var(--s2)',
          border: '1px dashed var(--border)',
          borderRadius: 8,
          lineHeight: 1.5,
        }}>
          No referrals yet. Share your link with other mobile tire shops — your first reward kicks in once they complete a paid month.
        </div>
      ) : (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {referrals.map((r) => (
            <ReferralRow key={r.id} referral={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatBlock({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? 'rgba(200,164,74,0.08)' : 'var(--s2)',
      border: `1px solid ${accent ? 'rgba(200,164,74,0.25)' : 'var(--border)'}`,
      borderRadius: 8,
      padding: '8px 6px',
      textAlign: 'center',
      minWidth: 0,
    }}>
      <div style={{
        fontSize: 18, fontWeight: 800,
        color: accent ? 'var(--brand-primary)' : 'var(--t1)',
        letterSpacing: '-0.3px',
        lineHeight: 1.1,
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 9, fontWeight: 700,
        color: 'var(--t3)',
        textTransform: 'uppercase', letterSpacing: 0.8,
        marginTop: 2,
      }}>
        {label}
      </div>
    </div>
  );
}

function ReferralRow({ referral: r }: { referral: ReferralDoc }) {
  const { pill, color, bg } = statusPresentation(r.status);
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
      padding: '10px 12px',
      background: 'var(--s2)',
      border: '1px solid var(--border)',
      borderRadius: 8,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: 'var(--t1)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {r.referredEmail || 'New referral'}
        </div>
        <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>
          {r.createdAt
            ? new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '—'}
          {r.rewardedAt && ' · rewarded'}
        </div>
      </div>
      <div style={{
        flexShrink: 0,
        fontSize: 10, fontWeight: 800,
        color, background: bg,
        padding: '4px 10px',
        borderRadius: 99,
        textTransform: 'uppercase', letterSpacing: 0.5,
      }}>
        {pill}
      </div>
    </div>
  );
}

function statusPresentation(s: ReferralStatus): { pill: string; color: string; bg: string } {
  switch (s) {
    case 'pending':    return { pill: 'Signed up',     color: 'var(--t2)',        bg: 'rgba(255,255,255,0.04)' };
    case 'trialing':   return { pill: 'Trialing',      color: 'var(--brand-primary)', bg: 'rgba(200,164,74,0.12)' };
    case 'converted':  return { pill: 'First paid',    color: '#22c55e',          bg: 'rgba(34,197,94,0.12)' };
    case 'rewarded':   return { pill: 'Reward applied', color: '#22c55e',          bg: 'rgba(34,197,94,0.18)' };
    case 'canceled':   return { pill: 'Canceled',      color: 'var(--t3)',        bg: 'rgba(255,255,255,0.04)' };
    case 'fraudulent': return { pill: 'Flagged',       color: '#ef4444',          bg: 'rgba(239,68,68,0.12)' };
    default:           return { pill: s,                color: 'var(--t3)',        bg: 'rgba(255,255,255,0.04)' };
  }
}

function ShareButton({ link }: { link: string }) {
  if (typeof navigator === 'undefined' || !navigator.share) return null;
  return (
    <button
      className="btn xs"
      onClick={() => {
        navigator.share({
          title: 'Mobile Service OS',
          text: 'Try Mobile Service OS — built for mobile tire and roadside businesses.',
          url: link,
        }).catch(() => { /* user canceled */ });
      }}
    >
      Share
    </button>
  );
}

function SmsButton({ link }: { link: string }) {
  const body = encodeURIComponent(
    `Try Mobile Service OS — built for mobile tire and roadside businesses. 14 days free. ${link}`,
  );
  return (
    <a className="btn xs" href={`sms:?&body=${body}`}>
      SMS
    </a>
  );
}

function EmailButton({ link }: { link: string }) {
  const subject = encodeURIComponent('Try Mobile Service OS');
  const body = encodeURIComponent(
    `Hey,\n\nI've been using Mobile Service OS to run my mobile tire business and figured you'd want to check it out.\n\n14 days free, then $39 (Core) or $89.99 (Pro). Use my link:\n\n${link}\n\n— Sent from Mobile Service OS`,
  );
  return (
    <a className="btn xs" href={`mailto:?subject=${subject}&body=${body}`}>
      Email
    </a>
  );
}

export default ReferralCard;
