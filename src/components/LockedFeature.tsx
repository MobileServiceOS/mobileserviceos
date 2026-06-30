// src/components/LockedFeature.tsx
// ─────────────────────────────────────────────────────────────────────
//  Reusable Paid-tier gate. Wrap any advanced feature; for FREE accounts
//  it renders a blurred, non-interactive PREVIEW of the real content with
//  a tailored one-line value prop and an upgrade CTA. For entitled
//  accounts (paid / trial-in-window / exempt / growth mode) it renders the
//  children untouched.
//
//  Native-aware CTA (App Review 3.1.1): on the web PWA it shows the
//  "$35/mo" upgrade button → web Stripe Checkout. Inside the native iOS
//  shell it shows NO external-checkout button — only "Manage your plan at
//  app.mobileserviceos.app" — so the binary never links to outside
//  purchase from within the app.
// ─────────────────────────────────────────────────────────────────────
import type { ReactNode } from 'react';
import type { Settings } from '@/types';
import { requiresUpgrade, PAID_FEATURE_COPY, type PaidFeature } from '@/lib/planAccess';
import { triggerUpgrade } from '@/lib/upgradeFlow';
import { isNative } from '@/lib/native';
import { PAID_PRICE_LINE } from '@/lib/pricing-display';

interface Props {
  feature: PaidFeature;
  settings: Settings | null | undefined;
  children: ReactNode;
  /** Optional: shrink the blurred preview to this height so a long screen
   *  doesn't render a giant blurred block. Defaults to natural height. */
  previewMaxHeight?: number;
  /** Override the upgrade action (defaults to the global upgrade flow). */
  onUpgrade?: () => void;
}

export function LockedFeature({ feature, settings, children, previewMaxHeight, onUpgrade }: Props) {
  // Entitled → render the real feature, no wrapper overhead.
  if (!requiresUpgrade(settings, feature)) return <>{children}</>;

  const copy = PAID_FEATURE_COPY[feature];
  const native = isNative();

  return (
    <div className="locked-feature" role="group" aria-label={`${copy.title} — paid feature`}>
      {/* Blurred, inert preview of the real content. aria-hidden so screen
          readers skip the decorative copy and hear only the overlay. */}
      <div className="locked-feature-preview" aria-hidden="true" style={previewMaxHeight ? { maxHeight: previewMaxHeight } : undefined}>
        {children}
      </div>
      <div className="locked-feature-overlay">
        <div className="locked-feature-card">
          <div className="locked-feature-icon" aria-hidden="true">🔒</div>
          <div className="locked-feature-title">{copy.title}</div>
          <div className="locked-feature-line">{copy.line}</div>
          {native ? (
            <div className="locked-feature-native">
              Included with MSOS Pro. Manage your plan at{' '}
              <span className="locked-feature-url">app.mobileserviceos.app</span>
            </div>
          ) : (
            <button
              type="button"
              className="locked-feature-cta"
              onClick={() => (onUpgrade ?? triggerUpgrade)()}
            >
              Upgrade to MSOS Pro · {PAID_PRICE_LINE}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
