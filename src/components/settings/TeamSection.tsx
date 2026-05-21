import { TeamManagement } from '@/components/TeamManagement';
import { AccordionShell } from '@/components/settings/AccordionShell';

// ─────────────────────────────────────────────────────────────────────
//  Team accordion
//
//  No longer plan-gated. Every account is on Pro, so the lock screen
//  has been replaced with the "coming soon" placeholder (matches the
//  pattern other in-progress features use elsewhere in the app).
// ─────────────────────────────────────────────────────────────────────

export function TeamAccordion({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <AccordionShell title="Team Management" icon="🧑‍🔧" summary="Invite & manage" open={open} onToggle={onToggle}>
      <TeamManagement />
    </AccordionShell>
  );
}
