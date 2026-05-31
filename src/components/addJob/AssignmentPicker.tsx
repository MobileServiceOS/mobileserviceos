// src/components/addJob/AssignmentPicker.tsx
// ═══════════════════════════════════════════════════════════════════
//  Inline assignment picker for AddJob. Visible only to owner/admin
//  AND only when the business has ≥1 active technician member. Tech
//  accounts never see this component — every job they create is
//  auto-assigned to themselves in saveJob.
// ═══════════════════════════════════════════════════════════════════

import { memo, useMemo } from 'react';
import type { MemberDoc } from '@/types';
import { assignableMembers, UNASSIGNED } from '@/lib/jobPermissions';

interface Props {
  value: string | undefined;
  onChange: (uid: string | undefined) => void;
  members: ReadonlyArray<MemberDoc>;
  currentUid: string;
}

// Perf P1-3 fix (2026-05-31): React.memo so the picker doesn't
// re-render on AddJob keystrokes that don't affect its props.
function AssignmentPickerImpl({ value, onChange, members, currentUid }: Props) {
  const options = useMemo(
    () => assignableMembers(members, currentUid),
    [members, currentUid],
  );
  // Always render for owner/admin — even when the only options are
  // Me + Unassigned. Lets a solo operator mark a job "Unassigned"
  // (needs scheduling) without inviting a teammate first, and makes
  // the assignment system discoverable.
  const selected = value === undefined || value === null ? UNASSIGNED : value;
  // Surface a friendly hint when no other assignable members exist
  // — distinguishes "you haven't invited a tech" from "you have a
  // tech but they haven't accepted the invite yet".
  const hasOthers = options.length > 2;

  return (
    <div className="form-group card-anim">
      <div className="form-group-title">Assigned to</div>
      <div className="chip-grid">
        {options.map((opt) => (
          <button
            key={opt.uid || '__unassigned'}
            type="button"
            className={'chip' + (selected === opt.uid ? ' active' : '')}
            onClick={() => onChange(opt.uid === UNASSIGNED ? undefined : opt.uid)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {!hasOthers && (
        <div style={{
          fontSize: 10, color: 'var(--t3)', marginTop: 6, lineHeight: 1.5,
        }}>
          Invite a technician or admin in Settings → Team Management.
          They'll appear here as a chip once they accept their invite.
        </div>
      )}
    </div>
  );
}

export const AssignmentPicker = memo(AssignmentPickerImpl);
