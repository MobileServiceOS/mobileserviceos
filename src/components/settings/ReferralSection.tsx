import type { Settings as SettingsT } from '@/types';
import { ReferralCard } from '@/components/ReferralCard';
import { AccordionShell } from '@/components/settings/AccordionShell';

// ─────────────────────────────────────────────────────────────────────
//  Referrals accordion — wraps ReferralCard in the standard shell
// ─────────────────────────────────────────────────────────────────────

export function ReferralAccordion({
  businessId, settings, open, onToggle,
}: {
  businessId: string;
  settings: SettingsT;
  open: boolean;
  onToggle: () => void;
}) {
  const credits = settings.referralCreditsMonths || 0;
  const total = settings.totalSuccessfulReferrals || 0;
  const summary = credits > 0
    ? `${credits} free month${credits === 1 ? '' : 's'} earned · ${total} referral${total === 1 ? '' : 's'}`
    : total > 0
      ? `${total} referral${total === 1 ? '' : 's'} in progress`
      : 'Invite businesses, earn free months';
  return (
    <AccordionShell
      title="Referrals"
      icon="🎁"
      summary={summary}
      open={open}
      onToggle={onToggle}
      badge={credits > 0 ? `+${credits}` : undefined}
    >
      <ReferralCard businessId={businessId} settings={settings} />
    </AccordionShell>
  );
}
