import type { Settings } from '@/types';
import { TeamManagement } from '@/components/TeamManagement';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { LockedFeature } from '@/components/LockedFeature';

// ─────────────────────────────────────────────────────────────────────
//  Team accordion
//
//  Team management (inviting techs/admins, multi-tech assignment) is a
//  Paid-tier feature. Free accounts see the invite UI as a locked preview
//  with an upgrade CTA; entitled accounts use it normally. Staged behind
//  GROWTH_MODE like every other gate.
// ─────────────────────────────────────────────────────────────────────

export function TeamAccordion({
  settings, open, onToggle,
}: { settings: Settings; open: boolean; onToggle: () => void }) {
  return (
    <AccordionShell title="Team Management" icon="🧑‍🔧" summary="Invite & manage" open={open} onToggle={onToggle}>
      <LockedFeature feature="teamManagement" settings={settings}>
        <TeamManagement />
      </LockedFeature>
    </AccordionShell>
  );
}
