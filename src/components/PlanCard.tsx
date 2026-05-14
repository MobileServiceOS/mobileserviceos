import type { Settings } from '@/types';
import { isBillingExempt } from '@/lib/planAccess';

/**
 * Single-plan subscription card for the Settings page.
 *
 * Mobile Service OS offers ONE plan (Pro, $99/mo, 14-day trial). This
 * card replaces the old Core-vs-Pro comparison UI. No plan picker, no
 * upgrade CTAs — every account is Pro by default; the card simply
 * surfaces trial status, billing copy, and the included feature list.
 *
 * Drop this into Settings.tsx wherever the old subscription/plan
 * section lived:
 *
 *     import PlanCard from '@/components/PlanCard';
 *     ...
 *     <PlanCard settings={settings} />
 */

interface Props {
  settings: Settings;
}

// All features included with the Pro plan. This is the single source
// of truth for the marketing list — change in one place if the
// feature set ever shifts.
const PRO_FEATURES: ReadonlyArray<string> = [
  'Quick Quote',
  'Job Logging',
  'Customer Management',
  'Branded Invoices',
  'Review Requests',
  'Expense Tracking',
  'Tire Inventory',
  'Profit Dashboard',
  'Pending Payment Tracking',
  'Technician Accounts',
  'Role Permissions',
  'Technician Attribution',
  'Team Inventory Workflow',
  'Advanced Analytics',
  'Owner / Admin Visibility',
  'Multi-user Operations',
  'PWA Install',
];

/**
 * Compute remaining trial days. Returns null when not trialing or when
 * the trial-end timestamp is missing/invalid.
 */
function trialDaysLeft(settings: Settings): number | null {
  if (settings.subscriptionStatus !== 'trialing') return null;
  const raw = settings.trialEndsAt;
  if (!raw) return null;
  let endMs: number;
  try {
    if (typeof raw === 'string') endMs = new Date(raw).getTime();
    else if (raw instanceof Date) endMs = raw.getTime();
    // Firestore Timestamp shape (toMillis exists on real instances)
    else if (raw && typeof (raw as { toMillis?: () => number }).toMillis === 'function') {
      endMs = (raw as { toMillis: () => number }).toMillis();
    } else {
      return null;
    }
  } catch {
    return null;
  }
  if (Number.isNaN(endMs)) return null;
  const diffMs = endMs - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export default function PlanCard({ settings }: Props) {
  const daysLeft = trialDaysLeft(settings);
  const isTrialing = settings.subscriptionStatus === 'trialing';
  const exempt = isBillingExempt(settings);

  // Billing-exempt accounts (VIP / founder / comp / internal) see a
  // dedicated "Lifetime Pro Access" card instead of the trial /
  // billing copy. Bypasses every Stripe-related UI element since
  // these accounts never pay.
  if (exempt) {
    return (
      <div className="form-group" style={{ position: 'relative' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 14,
        }}>
          <div>
            <div className="form-group-title" style={{ marginBottom: 4 }}>Subscription</div>
            <div style={{
              fontSize: 22,
              fontWeight: 800,
              color: 'var(--t1)',
              letterSpacing: '-.3px',
            }}>Lifetime Pro Access</div>
            <div style={{
              fontSize: 13,
              color: 'var(--t2)',
              marginTop: 4,
            }}>
              <span style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>
                No billing required
              </span>
              <span> · full Pro features unlocked permanently</span>
            </div>
          </div>
          <div className="pill gold" title="Lifetime exemption">
            Lifetime
          </div>
        </div>

        <div style={{
          background: 'var(--s2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '10px 12px',
          fontSize: 12,
          color: 'var(--t2)',
          marginBottom: 14,
          lineHeight: 1.5,
        }}>
          This account has lifetime Pro access. Stripe billing checks
          are bypassed; no payment is ever required.
        </div>

        <div style={{
          fontSize: 11,
          color: 'var(--t3)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 1,
          marginBottom: 8,
        }}>
          What's included
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px 14px',
        }}>
          {PRO_FEATURES.map((feat) => (
            <div key={feat} style={{
              fontSize: 12,
              color: 'var(--t1)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 0,
            }}>
              <span style={{ color: 'var(--brand-primary)', fontWeight: 800, flexShrink: 0 }}>✓</span>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {feat}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="form-group" style={{ position: 'relative' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 12,
        marginBottom: 14,
      }}>
        <div>
          <div className="form-group-title" style={{ marginBottom: 4 }}>Subscription</div>
          <div style={{
            fontSize: 22,
            fontWeight: 800,
            color: 'var(--t1)',
            letterSpacing: '-.3px',
          }}>Pro Plan</div>
          <div style={{
            fontSize: 13,
            color: 'var(--t2)',
            marginTop: 4,
          }}>
            <span style={{ fontWeight: 700, color: 'var(--brand-primary)' }}>$99</span>
            <span> / month · 14-day free trial</span>
          </div>
        </div>

        {isTrialing && daysLeft !== null && (
          <div className="pill gold" title="Free trial in progress">
            Trial · {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
          </div>
        )}
      </div>

      <div style={{
        background: 'var(--s2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '10px 12px',
        fontSize: 12,
        color: 'var(--t2)',
        marginBottom: 14,
      }}>
        Billing integration coming soon. Your trial is active and full Pro
        features are unlocked.
      </div>

      <div style={{
        fontSize: 11,
        color: 'var(--t3)',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 8,
      }}>
        What's included
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '6px 14px',
      }}>
        {PRO_FEATURES.map((feat) => (
          <div key={feat} style={{
            fontSize: 12,
            color: 'var(--t1)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
          }}>
            <span style={{ color: 'var(--brand-primary)', fontWeight: 800, flexShrink: 0 }}>✓</span>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {feat}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
