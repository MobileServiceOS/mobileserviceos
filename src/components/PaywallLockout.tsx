import type { Settings } from '@/types';
import { SubscribeButton } from '@/components/SubscribeButton';
import { PRO_PRICE, CORE_PRICE } from '@/lib/pricing-display';
import { useFocusTrap } from '@/lib/useFocusTrap';

// ─────────────────────────────────────────────────────────────────────
//  PaywallLockout — full-screen "choose a plan" gate
//
//  Replaces the entire app for accounts whose 14-day soft trial has
//  expired (or who never started one — i.e. pre-paywall existing
//  accounts). Renders nothing except the two plan cards + a sign-out
//  link. The only paths out of this screen are:
//    1. Click Subscribe → Stripe Checkout → subscription becomes
//       'active' (or 'trialing' with a real Stripe trial) → next
//       render, shouldLockApp returns false and the main app shows.
//    2. Click Sign Out → return to landing.
//
//  Two states by source of arrival:
//    - Soft trial expired (subscriptionStatus was 'trialing', date
//      is in the past) → headline: "Your 14-day trial has ended."
//    - Never trialed / canceled / past_due → headline: "Choose a
//      plan to continue."
// ─────────────────────────────────────────────────────────────────────

const CORE_FEATURES: ReadonlyArray<string> = [
  'Quick Quote',
  'Job Logging',
  'Branded Invoices',
  'Inventory Tracking',
  'Customer Management',
  'Pending Payments',
];

const PRO_FEATURES: ReadonlyArray<string> = [
  'Everything in Core',
  'Multi-Technician Access',
  'Role-Based Permissions',
  'Admin Visibility',
  'Per-Tech Profit Attribution',
  'Advanced Reporting',
];

interface Props {
  settings: Settings;
  onSignOut: () => void;
}

export function PaywallLockout({ settings, onSignOut }: Props) {
  // Audit a11y P1-4 (2026-05-31): the paywall is a full-screen
  // blocking dialog. Trap keyboard focus inside so AT users can't
  // accidentally tab back into the (visually obscured) app shell.
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  // Detect arrival source for the headline copy.
  const wasTrialing = settings.subscriptionStatus === 'trialing';
  const wasCanceled = settings.subscriptionStatus === 'canceled';
  const wasPastDue = settings.subscriptionStatus === 'past_due';

  const headline = wasTrialing
    ? 'Your 14-day free trial has ended.'
    : wasCanceled
      ? 'Your subscription was canceled.'
      : wasPastDue
        ? 'Your payment is past due.'
        : 'Choose a plan to continue.';

  const subhead = wasTrialing
    ? 'Pick a plan to keep using Mobile Service OS. Cancel anytime.'
    : wasPastDue
      ? 'Update your payment to keep your features active.'
      : 'Every plan unlocks the full feature set for your tier. Cancel anytime.';

  return (
    <div
      ref={trapRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Subscription required"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg)',
        zIndex: 10000,
        overflowY: 'auto',
        padding: '24px 18px 80px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <div style={{ width: '100%', maxWidth: 720, marginTop: 24 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
          <h1 style={{
            fontSize: 22,
            fontWeight: 800,
            color: 'var(--t1)',
            margin: '0 0 8px',
            letterSpacing: '-0.3px',
          }}>
            {headline}
          </h1>
          <p style={{
            fontSize: 14,
            color: 'var(--t2)',
            margin: 0,
            lineHeight: 1.5,
          }}>
            {subhead}
          </p>
        </div>

        {/* Plan cards */}
        <div className="lockout-grid">
          <PlanCardCompact
            tier="core"
            price={CORE_PRICE}
            tagline="Solo mobile operators"
            features={CORE_FEATURES}
            settings={settings}
          />
          <PlanCardCompact
            tier="pro"
            price={PRO_PRICE}
            tagline="Multi-tech roadside teams"
            features={PRO_FEATURES}
            settings={settings}
            recommended
          />
        </div>

        {/* Trust line */}
        <div style={{
          textAlign: 'center',
          marginTop: 18,
          fontSize: 12,
          color: 'var(--t3)',
          lineHeight: 1.5,
        }}>
          Billed monthly · Cancel anytime from your account
        </div>

        {/* Sign out — last resort */}
        <div style={{ textAlign: 'center', marginTop: 32 }}>
          <button
            onClick={onSignOut}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--t3)',
              fontSize: 12,
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 8,
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <style>{`
        .lockout-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
        }
        @media (min-width: 600px) {
          .lockout-grid {
            grid-template-columns: 1fr 1fr;
            gap: 16px;
          }
        }
      `}</style>
    </div>
  );
}

function PlanCardCompact({
  tier,
  price,
  tagline,
  features,
  settings,
  recommended = false,
}: {
  tier: 'core' | 'pro';
  price: string;
  tagline: string;
  features: ReadonlyArray<string>;
  settings: Settings;
  recommended?: boolean;
}) {
  const label = tier === 'pro' ? 'Pro' : 'Core';
  return (
    <div style={{
      position: 'relative',
      background: recommended
        ? 'linear-gradient(180deg, rgba(200,164,74,0.08) 0%, var(--s1) 100%)'
        : 'var(--s1)',
      border: recommended
        ? '1px solid rgba(200,164,74,0.4)'
        : '1px solid var(--border)',
      borderRadius: 14,
      padding: '20px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }}>
      {recommended && (
        <div style={{
          position: 'absolute',
          top: -10,
          right: 16,
          background: 'var(--brand-primary)',
          color: '#0a0a0a',
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 0.8,
          padding: '4px 10px',
          borderRadius: 99,
          textTransform: 'uppercase',
        }}>
          Recommended
        </div>
      )}
      <div>
        <div style={{
          fontSize: 11,
          fontWeight: 800,
          color: 'var(--t3)',
          textTransform: 'uppercase',
          letterSpacing: 1.5,
          marginBottom: 4,
        }}>
          {label}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{
            fontSize: 30,
            fontWeight: 800,
            color: 'var(--t1)',
            letterSpacing: '-0.5px',
            lineHeight: 1,
          }}>
            {price}
          </span>
          <span style={{ fontSize: 13, color: 'var(--t3)', fontWeight: 600 }}>
            /month
          </span>
        </div>
        <div style={{
          fontSize: 12,
          color: 'var(--t2)',
          marginTop: 8,
          lineHeight: 1.4,
        }}>
          {tagline}
        </div>
      </div>
      <ul style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        flex: 1,
      }}>
        {features.map((feat) => (
          <li key={feat} style={{
            fontSize: 12.5,
            color: 'var(--t1)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 7,
            lineHeight: 1.4,
          }}>
            <span style={{ color: 'var(--brand-primary)', fontWeight: 800, flexShrink: 0 }}>
              ✓
            </span>
            <span>{feat}</span>
          </li>
        ))}
      </ul>
      <SubscribeButton settings={settings} plan={tier} />
    </div>
  );
}
