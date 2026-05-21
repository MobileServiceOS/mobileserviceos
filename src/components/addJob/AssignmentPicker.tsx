// src/components/addJob/AssignmentPicker.tsx
// ═══════════════════════════════════════════════════════════════════
//  Inline assignment picker for AddJob. Visible only to owner/admin
//  AND only when the business has ≥1 active technician member. Tech
//  accounts never see this component — every job they create is
//  auto-assigned to themselves in saveJob.
// ═══════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import type { MemberDoc } from '@/types';
import { assignableMembers, UNASSIGNED } from '@/lib/jobPermissions';

interface Props {
  value: string | undefined;
  onChange: (uid: string | undefined) => void;
  members: ReadonlyArray<MemberDoc>;
  currentUid: string;
}

export function AssignmentPicker({ value, onChange, members, currentUid }: Props) {
  const options = useMemo(
    () => assignableMembers(members, currentUid),
    [members, currentUid],
  );
  // Hide entirely when there are no technicians to assign to — the
  // picker would just show "Me" + "Unassigned" with no real
  // assignment choice.
  const hasTechs = options.length > 2;
  if (!hasTechs) return null;

  const selected = value === undefined || value === null ? UNASSIGNED : value;

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
    </div>
  );
}
