// src/components/NotificationsBell.tsx
// ═══════════════════════════════════════════════════════════════════
//  Header icon with unread + pending badge. Tap → open
//  NotificationsPanel. Badge counts unread in-app + pending
//  customer-channel notifications combined.
// ═══════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { useNotifications } from '@/lib/useNotifications';
import { NotificationsPanel } from '@/components/NotificationsPanel';

interface Props {
  onNavigateToJob?: (jobId: string) => void;
}

export function NotificationsBell({ onNavigateToJob }: Props) {
  const { unreadCount, pendingCount } = useNotifications();
  const [open, setOpen] = useState(false);
  const badge = unreadCount + pendingCount;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Notifications"
        style={{
          position: 'relative',
          background: 'transparent', border: 0,
          padding: 6, cursor: 'pointer',
          fontSize: 20, color: 'var(--t1)',
        }}
      >
        🔔
        {badge > 0 && (
          <span
            style={{
              position: 'absolute', top: 0, right: 0,
              background: 'var(--amber)', color: '#000',
              fontSize: 10, fontWeight: 800,
              borderRadius: 10, padding: '2px 5px',
              minWidth: 16, textAlign: 'center',
              lineHeight: 1,
            }}
          >
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
      {open && (
        <NotificationsPanel
          onClose={() => setOpen(false)}
          onNavigateToJob={onNavigateToJob}
        />
      )}
    </>
  );
}
