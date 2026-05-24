import { useEffect, useState } from 'react';
import type { NotificationDoc, TabId } from '@/types';
import { _auth } from '@/lib/firebase';
import { useBrand } from '@/context/BrandContext';
import {
  subscribeToMyNotifications,
  markNotificationRead,
  notificationsUnreadCount,
  notificationRelative,
  isUnreadFor,
} from '@/lib/notifications';

// ─────────────────────────────────────────────────────────────────────
//  NotificationCenter — bell-icon trigger + bottom sheet history.
//
//  Render location: global header (next to the BusinessSwitcher), so
//  every screen has access. Owners + admins see it; technicians see
//  it too (their job_assigned notifications matter most). The badge
//  fades in only when there are unread items.
//
//  Tap a row → markRead + route to the notification's `routeTo.tab`
//  (deep-link). When routeTo is missing, the row is a passive
//  history entry that just marks read on tap.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  /** Called when the user taps a notification with a routeTo hint.
   *  Receives the target TabId so App.tsx can switch the active tab
   *  + scroll the relevant entity into view (handled by the page). */
  onNavigate?: (tab: TabId, entityId?: string) => void;
}

export function NotificationCenter({ onNavigate }: Props) {
  const { businessId } = useBrand();
  const myUid = _auth?.currentUser?.uid || null;
  const [notifs, setNotifs] = useState<NotificationDoc[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    return subscribeToMyNotifications(businessId, setNotifs);
  }, [businessId]);

  const unread = notificationsUnreadCount(notifs, myUid);

  const handleTap = async (n: NotificationDoc) => {
    if (myUid && isUnreadFor(n, myUid)) {
      void markNotificationRead(businessId, n.id);
    }
    if (n.routeTo && onNavigate) {
      onNavigate(n.routeTo.tab, n.routeTo.entityId);
      setOpen(false);
    }
  };

  const markAllRead = async () => {
    if (!myUid || !businessId) return;
    const unreadList = notifs.filter((n) => isUnreadFor(n, myUid));
    await Promise.all(unreadList.map((n) => markNotificationRead(businessId, n.id)));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Notifications"
        style={{
          position: 'relative',
          background: 'var(--s3)', border: '1px solid var(--border)', borderRadius: 8,
          width: 32, height: 32, minHeight: 32,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, color: 'var(--t2)', padding: 0,
          cursor: 'pointer',
        }}
      >
        🔔
        {unread > 0 && (
          <span
            aria-label={`${unread} unread`}
            style={{
              position: 'absolute', top: -4, right: -4,
              minWidth: 16, height: 16, padding: '0 4px',
              borderRadius: 999,
              background: '#ef4444', color: '#fff',
              fontSize: 9, fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 0 2px var(--s1)',
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.55)', zIndex: 9000,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card-anim"
            style={{
              width: '100%', maxWidth: 560,
              background: 'var(--s1)',
              borderTopLeftRadius: 16, borderTopRightRadius: 16,
              padding: '14px 14px calc(28px + env(safe-area-inset-bottom)) 14px',
              maxHeight: '85vh', overflowY: 'auto',
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
              alignItems: 'center', marginBottom: 12,
            }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Notifications</div>
              {unread > 0 && (
                <button
                  type="button"
                  className="btn xs ghost"
                  onClick={markAllRead}
                  style={{ fontSize: 11 }}
                >
                  Mark all read
                </button>
              )}
            </div>

            {notifs.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">🔕</div>
                <div className="empty-state-title">No notifications yet</div>
                <div className="empty-state-sub">
                  You'll see job assignments, payments, and inventory alerts here.
                </div>
              </div>
            ) : (
              <div className="stack">
                {notifs.map((n) => {
                  const isUnread = isUnreadFor(n, myUid);
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => handleTap(n)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 12,
                        width: '100%', padding: '12px 14px',
                        background: isUnread ? 'var(--s3)' : 'var(--s2)',
                        border: '1px solid ' + (isUnread ? 'rgba(244,180,0,.35)' : 'var(--border)'),
                        borderRadius: 10,
                        color: 'var(--t1)', cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <span aria-hidden="true" style={{
                        display: 'inline-block', width: 8, height: 8,
                        borderRadius: 999, marginTop: 6, flexShrink: 0,
                        background: isUnread ? 'var(--brand-primary)' : 'transparent',
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: isUnread ? 800 : 600,
                          color: 'var(--t1)',
                        }}>
                          {n.title}
                        </div>
                        {n.body && (
                          <div style={{
                            fontSize: 11, color: 'var(--t2)',
                            marginTop: 3, lineHeight: 1.4,
                          }}>
                            {n.body}
                          </div>
                        )}
                      </div>
                      <div style={{
                        fontSize: 10, color: 'var(--t3)',
                        flexShrink: 0, paddingTop: 2,
                      }}>
                        {notificationRelative(n.createdAt)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
