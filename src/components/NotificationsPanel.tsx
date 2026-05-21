// src/components/NotificationsPanel.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bottom-sheet list of notifications. Newest first. Tap row →
//  marks read + (caller-driven) navigates to job. Pending SMS/email
//  rows have a [Send] button that opens the OS messaging app.
// ═══════════════════════════════════════════════════════════════════

import { useEffect } from 'react';
import { useNotifications } from '@/lib/useNotifications';
import { buildSmsUri, buildMailtoUri, openMessagingUri } from '@/lib/openMessagingUri';
import type { NotificationDoc } from '@/types';

interface Props {
  onClose: () => void;
  onNavigateToJob?: (jobId: string) => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function iconFor(n: NotificationDoc): string {
  if (n.channel === 'sms') return '📱';
  if (n.channel === 'email') return '✉️';
  return '🔔';
}

export function NotificationsPanel({ onClose, onNavigateToJob }: Props) {
  const { notifications, markRead, markAllRead, markSent } = useNotifications();

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const handleRowTap = async (n: NotificationDoc): Promise<void> => {
    if (!n.readAt) await markRead(n.id);
    if (onNavigateToJob) onNavigateToJob(n.jobId);
    onClose();
  };

  const handleSendTap = async (e: React.MouseEvent, n: NotificationDoc): Promise<void> => {
    e.stopPropagation();
    const uri = n.channel === 'sms'
      ? buildSmsUri(n.toPhone || '', n.body)
      : buildMailtoUri(n.toEmail || '', n.subject || '', n.body);
    openMessagingUri(uri);
    await markSent(n.id);
  };

  return (
    <div
      className="more-sheet-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 9000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720,
          background: 'var(--s1)',
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          padding: '14px 14px calc(28px + env(safe-area-inset-bottom)) 14px',
          maxHeight: '75vh', overflowY: 'auto',
          borderTop: '1px solid var(--border)',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{
          width: 40, height: 4, background: 'var(--t3)',
          borderRadius: 4, margin: '2px auto 14px', opacity: 0.5,
        }} />

        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'baseline', marginBottom: 10,
        }}>
          <span style={{
            fontSize: 11, fontWeight: 800,
            color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1.5,
          }}>
            Notifications ({notifications.length})
          </span>
          {notifications.some((n) => !n.readAt) && (
            <button
              type="button"
              onClick={() => { void markAllRead(); }}
              className="btn xs secondary"
            >Mark all read</button>
          )}
        </div>

        {notifications.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
            No notifications yet — they'll appear as jobs move through stages.
          </div>
        ) : (
          notifications.map((n) => {
            const isPending = (n.channel === 'sms' || n.channel === 'email') && !n.sentAt;
            const isUnread = !n.readAt;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => { void handleRowTap(n); }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  width: '100%', textAlign: 'left',
                  padding: '12px 10px', marginBottom: 6,
                  background: isUnread ? 'var(--s2)' : 'transparent',
                  border: '1px solid var(--border)', borderRadius: 10,
                  color: 'var(--t1)', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 18 }}>{iconFor(n)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: isUnread ? 700 : 500, marginBottom: 2 }}>
                    {n.subject || n.body.split('\n')[0]}
                  </div>
                  {n.subject && (
                    <div style={{ fontSize: 11, color: 'var(--t3)', whiteSpace: 'pre-line' }}>
                      {n.body}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                    {timeAgo(n.createdAt)}
                    {n.sentAt && ' · sent'}
                  </div>
                </div>
                {isPending && (
                  <button
                    type="button"
                    onClick={(e) => { void handleSendTap(e, n); }}
                    className="btn xs primary"
                  >Send</button>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
