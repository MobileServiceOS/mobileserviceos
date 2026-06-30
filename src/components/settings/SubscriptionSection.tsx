import { useState } from 'react';
import type { Settings as SettingsT } from '@/types';
import { addToast } from '@/lib/toast';
import { createPortalLink } from '@/lib/stripeSync';
import { SubscribeButton } from '@/components/SubscribeButton';
import { isBillingExempt, resolvePlan, hasActiveSubscription } from '@/lib/planAccess';
import { isGrowthMode, FOUNDER_DISCOUNT_PERCENT, FOUNDER_DISCOUNT_TERM_MONTHS } from '@/lib/growthMode';
import { PRO_PRICE, CORE_PRICE, PRO_PRICE_LINE_COMPACT, CORE_PRICE_LINE_COMPACT } from '@/lib/pricing-display';
import { AccordionShell } from '@/components/settings/AccordionShell';

// ─────────────────────────────────────────────────────────────────────
//  Subscription accordion — single Pro plan card
//
//  Replaces the old Core-vs-Pro comparison UI. Mobile Service OS now
//  offers one plan ($89.99/mo Pro with a 14-day free trial). Shows:
//    - Plan name + price
//    - Trial countdown pill when subscriptionStatus === 'trialing'
//    - "Billing integration coming soon" notice
//    - The full feature checklist (Pro includes everything)
//
//  No upgrade button, no plan toggle, no Core comparison.
// ─────────────────────────────────────────────────────────────────────

const CORE_FEATURES: ReadonlyArray<string> = [
  'Quick Quote',
  'Job Logging',
  'Basic Invoices',
  'Inventory Tracking',
  'Customer Management',
  'Pending Payments',
  'PWA Install',
  'Single User Access',
];

const PRO_FEATURES: ReadonlyArray<string> = [
  'Everything in Core',
  'Technician Accounts',
  'Role Permissions',
  'Team Inventory Workflow',
  'Technician Attribution',
  'Advanced Analytics',
  'Profit Dashboard',
  'Multi-user Operations',
  'Owner / Admin Visibility',
  'Branded Invoices',
];

/**
 * Compute remaining trial days. Returns null when not trialing or
 * when the trialEndsAt field is missing/unparseable. Handles ISO
 * string, JS Date, and Firestore Timestamp shapes — see Settings
 * type for why all three are valid at rest.
 */
function trialDaysLeft(settings: SettingsT): number | null {
  if (settings.subscriptionStatus !== 'trialing') return null;
  const raw = settings.trialEndsAt;
  if (!raw) return null;
  let endMs: number;
  try {
    if (typeof raw === 'string') endMs = new Date(raw).getTime();
    else if (raw instanceof Date) endMs = raw.getTime();
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

export function SubscriptionAccordion({ settings, open, onToggle }: { settings: SettingsT; open: boolean; onToggle: () => void }) {
  const daysLeft = trialDaysLeft(settings);
  const isTrialing = settings.subscriptionStatus === 'trialing';
  const exempt = isBillingExempt(settings);
  // Founding Member early-access phase. When growthMode is on, the
  // account is "exempt" via isBillingExempt — but we present the
  // premium Founding Member panel rather than the internal "Lifetime
  // Pro" panel (which is reserved for Admin-granted comp accounts).
  const founder = isGrowthMode();
  const founderPct = settings.founderDiscountPercent ?? FOUNDER_DISCOUNT_PERCENT;
  const founderTerm = settings.founderDiscountTermMonths ?? FOUNDER_DISCOUNT_TERM_MONTHS;
  const status = settings.subscriptionStatus;
  const isPaid = status === 'active' || status === 'past_due';
  const isPastDue = status === 'past_due';
  const isCanceled = status === 'canceled';
  // `hasActive` tells us whether the user has a CONFIRMED Stripe
  // subscription (active/trialing/past_due) or is billing-exempt.
  // We never show "Current Plan" for accounts without an active
  // subscription — they're free-tier signups picking their first plan.
  const hasActive = hasActiveSubscription(settings);
  const currentPlan = resolvePlan(settings);

  // Render BOTH plan cards for every non-exempt account, regardless
  // of whether the build-time price IDs were injected. If a price ID
  // is missing at build time the SubscribeButton inside the card
  // shows an inline diagnostic instead of silently hiding the card —
  // hidden cards are worse than a clear error message.
  // Two-tier model (2026-06): Free + Paid. There is no purchasable Core
  // tier anymore — the free tier replaces it — so only the single Paid
  // ("Pro", $35/mo) card is shown.
  const showPro = true;
  const showCore = false;

  // Accordion summary line — adapts to state.
  const summary = founder
    ? 'Founding Member · Early Access'
    : exempt
    ? `Pro · Lifetime${settings.subscriptionOverride && settings.subscriptionOverride !== 'lifetime'
        ? ` (${settings.subscriptionOverride})` : ''}`
    : isTrialing && daysLeft !== null
      ? `${currentPlan === 'pro' ? 'Pro' : 'Core'} · Trial · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`
      : isPaid
        ? `${currentPlan === 'pro' ? 'Pro' : 'Core'} · ${currentPlan === 'pro' ? PRO_PRICE_LINE_COMPACT : CORE_PRICE_LINE_COMPACT}`
        : 'Choose a plan';

  // Summary badge — pill shown in the closed-accordion header.
  // Only show the plan name when we KNOW the user is on that plan;
  // otherwise show a neutral "Trial" or "Free" badge to avoid the
  // misleading "Core" badge appearing on accounts with no real plan.
  const summaryBadge = founder
    ? 'Founder'
    : exempt
    ? 'Lifetime'
    : isTrialing
      ? 'Trial'
      : hasActive
        ? (currentPlan === 'pro' ? 'Pro' : 'Core')
        : 'Free';

  return (
    <div data-section="subscription">
    <AccordionShell
      title="Subscription"
      icon="⭐"
      summary={summary}
      open={open}
      onToggle={onToggle}
      badge={summaryBadge}
    >
      {/* ─── State banner — context for the current account ───── */}
      <div style={{
        background: isPastDue
          ? 'rgba(239,68,68,0.08)'
          : isTrialing
            ? 'rgba(200,164,74,0.08)'
            : 'var(--s2)',
        border: `1px solid ${isPastDue
          ? 'rgba(239,68,68,0.3)'
          : isTrialing
            ? 'rgba(200,164,74,0.25)'
            : 'var(--border)'}`,
        borderRadius: 10,
        padding: '12px 14px',
        fontSize: 13,
        color: 'var(--t1)',
        marginBottom: 16,
        lineHeight: 1.5,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        {founder ? (
          <>
            <span style={{ fontSize: 16 }}>👑</span>
            <span>
              <strong style={{ color: 'var(--brand-primary)' }}>Founding Member access enabled.</strong>{' '}
              Full Pro features unlocked, with your {founderPct}% founder rate
              reserved to your account.
            </span>
          </>
        ) : exempt ? (
          <>
            <span style={{ fontSize: 16 }}>👑</span>
            <span>
              <strong style={{ color: 'var(--brand-primary)' }}>Lifetime Pro access.</strong>{' '}
              No billing required — full Pro features unlocked permanently.
            </span>
          </>
        ) : isTrialing && daysLeft !== null ? (
          <>
            <span style={{ fontSize: 16 }}>⏳</span>
            <span>
              <strong style={{ color: 'var(--brand-primary)' }}>14-day free trial active.</strong>{' '}
              {daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining. Pick a plan below to continue past the trial.
            </span>
          </>
        ) : isPastDue ? (
          <>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <span>
              <strong style={{ color: '#ef4444' }}>Payment past due.</strong>{' '}
              Update your card to keep your features active.
            </span>
          </>
        ) : isCanceled ? (
          <>
            <span style={{ fontSize: 16 }}>📭</span>
            <span>
              <strong>Subscription canceled.</strong>{' '}
              Pick a plan below to restore access.
            </span>
          </>
        ) : isPaid ? (
          <>
            <span style={{ fontSize: 16 }}>✓</span>
            <span>
              <strong style={{ color: 'var(--brand-primary)' }}>Subscription active.</strong>{' '}
              You're on the {currentPlan === 'pro' ? 'Pro' : 'Core'} plan.
            </span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 16 }}>🚀</span>
            <span>Pick a plan below to get started. Both include a 14-day free trial.</span>
          </>
        )}
      </div>

      {/* ─── Founding Member panel ────────────────────────────────
          Premium membership panel shown while growthMode is on. The
          plan-card grid (below, in the else branch) returns
          automatically when growthMode is turned off — see
          src/lib/growthMode.ts. */}
      {founder ? (
        <div style={{
          background: 'linear-gradient(160deg, rgba(200,164,74,0.13) 0%, rgba(200,164,74,0.04) 45%, rgba(200,164,74,0.02) 100%)',
          border: '1px solid rgba(200,164,74,0.32)',
          borderRadius: 14,
          padding: '20px 18px 16px',
          marginBottom: 12,
        }}>
          {/* Eyebrow + header */}
          <div style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '1.4px',
            textTransform: 'uppercase',
            color: 'var(--brand-primary)',
            opacity: 0.85,
            marginBottom: 6,
          }}>
            👑 Early Access
          </div>
          <h3 style={{
            fontSize: 19,
            fontWeight: 700,
            color: 'var(--t1)',
            margin: '0 0 4px',
            letterSpacing: '-0.2px',
          }}>
            Founding Member Access
          </h3>
          <p style={{ fontSize: 12.5, color: 'var(--t3)', margin: '0 0 16px', lineHeight: 1.5 }}>
            Your account has Founder access enabled with full Pro features unlocked.
          </p>

          {/* Headline rate — the hero number */}
          <div style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            padding: '12px 14px',
            background: 'rgba(200,164,74,0.10)',
            border: '1px solid rgba(200,164,74,0.22)',
            borderRadius: 10,
            marginBottom: 14,
          }}>
            <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--brand-primary)', lineHeight: 1, letterSpacing: '-1px' }}>
              {founderPct}% off
            </span>
            <span style={{ fontSize: 12, color: 'var(--t2)', fontWeight: 600 }}>
              founder rate, reserved to your account
            </span>
          </div>

          {/* Main message */}
          <p style={{ fontSize: 13, color: 'var(--t1)', lineHeight: 1.6, margin: '0 0 16px' }}>
            You're one of the early businesses building on Mobile Service OS.
            Your founder rate — <strong style={{ color: 'var(--brand-primary)' }}>
            {founderPct}% off your first {founderTerm} months</strong> — is locked
            to your account and stays with you as the platform grows.
          </p>

          {/* Benefits */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {[
              'Full Pro feature access',
              'Founder pricing locked in',
              'Referral rewards active',
              'Priority access to future upgrades',
            ].map((line) => (
              <div key={line} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13,
                color: 'var(--t1)',
                fontWeight: 500,
              }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  background: 'rgba(200,164,74,0.16)',
                  color: 'var(--brand-primary)',
                  fontSize: 11,
                  fontWeight: 800,
                  flexShrink: 0,
                }}>✓</span>
                <span>{line}</span>
              </div>
            ))}
          </div>

          {/* Footer — membership date + reassurance */}
          <div style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px solid rgba(200,164,74,0.18)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}>
            <span style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.5 }}>
              Founding Member accounts retain preferred pricing as the platform expands.
            </span>
            {settings.foundingJoinedAt && (
              <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600 }}>
                Member since {new Date(settings.foundingJoinedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* ─── Plan cards — Core (left) + Pro (right) ───────────── */}
          <div className="plan-card-grid">
            {showCore && (
              <PlanCard
                tier="core"
                price={CORE_PRICE}
                tagline="Perfect for solo mobile operators"
                features={CORE_FEATURES}
                isCurrent={hasActive && currentPlan === 'core' && !exempt}
                isRecommended={false}
                settings={settings}
                exempt={exempt}
              />
            )}
            {showPro && (
              <PlanCard
                tier="pro"
                price={PRO_PRICE}
                tagline="Built for multi-tech roadside businesses"
                features={PRO_FEATURES}
                isCurrent={(hasActive && currentPlan === 'pro') || exempt}
                isRecommended={!hasActive || (currentPlan === 'core' && !exempt)}
                settings={settings}
                exempt={exempt}
              />
            )}
          </div>

          {/* Manage billing — visible whenever there's a Stripe
              subscription on file (trialing OR paid), not just when
              isPaid. Previously a user could subscribe at noon,
              change their mind at 1pm, and have no path to cancel
              from inside the app because the trialing state hid this
              CTA. The Stripe Portal handles cancel / update card /
              view invoices uniformly across all states. */}
          {!!settings.stripeSubscriptionId && !exempt && (
            <ManageBillingLink />
          )}
        </>
      )}

      <style>{`
        .plan-card-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
          margin-bottom: 12px;
        }
        @media (min-width: 600px) {
          .plan-card-grid {
            grid-template-columns: 1fr 1fr;
            gap: 14px;
          }
        }
      `}</style>
    </AccordionShell>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  PlanCard — single subscription plan card
//
//  Renders inside the Subscription accordion. Two of these appear
//  side-by-side on tablet/desktop, stacked on mobile.
//
//  Visual treatment:
//    - Current plan: gold border + gold tint background + "Current Plan"
//      pill badge in the corner. The CTA inside renders as a non-
//      interactive "Current Plan ✓" button.
//    - Recommended plan (Pro when user is on Core/trial/none): subtle
//      gold accent + "Recommended" badge in the corner.
//    - Otherwise: plain card.
// ─────────────────────────────────────────────────────────────────────

function PlanCard({
  tier,
  price,
  tagline,
  features,
  isCurrent,
  isRecommended,
  settings,
  exempt,
}: {
  tier: 'core' | 'pro';
  price: string;
  tagline: string;
  features: ReadonlyArray<string>;
  isCurrent: boolean;
  isRecommended: boolean;
  settings: SettingsT;
  exempt: boolean;
}) {
  const label = tier === 'pro' ? 'Pro' : 'Core';

  // Visual treatment: gold border on either current plan or recommended.
  const accent = isCurrent || (isRecommended && tier === 'pro');

  return (
    <div
      style={{
        position: 'relative',
        background: accent
          ? 'linear-gradient(180deg, rgba(200,164,74,0.06) 0%, var(--s1) 100%)'
          : 'var(--s1)',
        border: accent
          ? '1px solid rgba(200,164,74,0.35)'
          : '1px solid var(--border)',
        borderRadius: 14,
        padding: '18px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minWidth: 0,
      }}
    >
      {/* Top-right badge — only one shows at a time */}
      {isCurrent ? (
        <div style={{
          position: 'absolute',
          top: -10,
          right: 14,
          background: 'var(--brand-primary)',
          color: '#0a0a0a',
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 0.8,
          padding: '4px 10px',
          borderRadius: 99,
          textTransform: 'uppercase',
        }}>
          Current Plan
        </div>
      ) : (isRecommended && tier === 'pro') ? (
        <div style={{
          position: 'absolute',
          top: -10,
          right: 14,
          background: 'rgba(200,164,74,0.15)',
          color: 'var(--brand-primary)',
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 0.8,
          padding: '4px 10px',
          borderRadius: 99,
          border: '1px solid rgba(200,164,74,0.4)',
          textTransform: 'uppercase',
        }}>
          Recommended
        </div>
      ) : null}

      {/* Header: plan name + price */}
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
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 4,
        }}>
          <span style={{
            fontSize: 28,
            fontWeight: 800,
            color: 'var(--t1)',
            letterSpacing: '-0.5px',
            lineHeight: 1,
          }}>
            {price}
          </span>
          <span style={{
            fontSize: 13,
            color: 'var(--t3)',
            fontWeight: 600,
          }}>
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

      {/* Feature checklist */}
      <ul style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        flex: 1,
      }}>
        {features.map((feat) => (
          <li key={feat} style={{
            fontSize: 12,
            color: 'var(--t1)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            lineHeight: 1.4,
          }}>
            <span style={{
              color: 'var(--brand-primary)',
              fontWeight: 800,
              flexShrink: 0,
            }}>✓</span>
            <span>{feat}</span>
          </li>
        ))}
      </ul>

      {/* CTA — context-aware via SubscribeButton. For exempt accounts,
          show a static "Active · Lifetime" pill instead. */}
      {exempt ? (
        <div style={{
          width: '100%',
          marginTop: 8,
          padding: '10px',
          background: tier === 'pro'
            ? 'rgba(200,164,74,.12)'
            : 'var(--s2)',
          border: tier === 'pro'
            ? '1px solid rgba(200,164,74,.4)'
            : '1px solid var(--border)',
          borderRadius: 10,
          color: tier === 'pro' ? 'var(--brand-primary)' : 'var(--t3)',
          fontWeight: 700,
          fontSize: 12,
          textAlign: 'center',
        }}>
          {tier === 'pro' ? '✓ Active · Lifetime' : 'Not applicable'}
        </div>
      ) : (
        <SubscribeButton settings={settings} plan={tier} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  ManageBillingLink — secondary "Manage in Stripe" link
//
//  Shown beneath the plan cards when the user has an active or past-
//  due subscription. Provides access to the Stripe Customer Portal
//  for actions not handled by the plan cards: update card, view
//  invoices, cancel subscription.
// ─────────────────────────────────────────────────────────────────────

function ManageBillingLink() {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      const url = await createPortalLink();
      window.location.assign(url);
    } catch (e) {
      addToast((e as Error).message || 'Could not open Stripe', 'error');
      setBusy(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      style={{
        width: '100%',
        padding: '10px',
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 10,
        color: 'var(--t2)',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        marginTop: 4,
      }}
    >
      {busy ? 'Opening Stripe…' : 'Manage billing in Stripe →'}
    </button>
  );
}
