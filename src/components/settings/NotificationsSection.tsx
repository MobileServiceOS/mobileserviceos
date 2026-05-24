import { useEffect, useState } from 'react';
import type { NotificationCategory, NotificationPrefs } from '@/types';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABELS } from '@/types';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { useBrand } from '@/context/BrandContext';
import {
  subscribeToMyNotificationPrefs,
  setMyNotificationPref,
} from '@/lib/notifications';

// ─────────────────────────────────────────────────────────────────────
//  Notification preferences — per-category opt-out toggles for the
//  current user. Persisted at
//  businesses/{bid}/notificationPrefs/{uid}; self-managed (each
//  user writes only their own doc, enforced by firestore.rules).
//
//  Defaults are "on for every category" — a missing prefs doc means
//  the user sees every notification. Toggles flip categories OFF;
//  flipping back ON removes the off flag.
//
//  Side effect: createNotification() callers can read these prefs
//  via userHasOptedOut() to skip writes the user wouldn't see anyway.
//  v1 doesn't do this — the doc-write is cheap and the central read
//  filter handles it — but the path is open for later.
// ─────────────────────────────────────────────────────────────────────

export function NotificationsAccordion({
  open, onToggle,
}: { open: boolean; onToggle: () => void }) {
  const { businessId } = useBrand();
  const [prefs, setPrefs] = useState<NotificationPrefs>({ uid: '', byCategory: {} });

  useEffect(() => {
    return subscribeToMyNotificationPrefs(businessId, setPrefs);
  }, [businessId]);

  const offCount = Object.values(prefs.byCategory).filter((v) => v === false).length;
  const summary = offCount === 0
    ? 'All categories on'
    : `${offCount} category off`;

  return (
    <AccordionShell title="Notifications" icon="🔔" summary={summary} open={open} onToggle={onToggle}>
      <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 12, lineHeight: 1.5 }}>
        Pick which notifications appear in your in-app notification
        center. Off-categories are skipped for you only — your
        teammates still see them.
      </div>
      <div className="stack">
        {NOTIFICATION_CATEGORIES.map((cat) => {
          // Missing entry = on (default). Explicit false = off.
          const enabled = prefs.byCategory[cat] !== false;
          return (
            <label
              key={cat}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px',
                background: 'var(--s2)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                cursor: 'pointer', minHeight: 52,
              }}
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => {
                  void setMyNotificationPref(businessId, cat as NotificationCategory, e.target.checked);
                }}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>
                {NOTIFICATION_CATEGORY_LABELS[cat]}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 700,
                color: enabled ? 'var(--green)' : 'var(--t3)',
              }}>
                {enabled ? 'On' : 'Off'}
              </span>
            </label>
          );
        })}
      </div>
    </AccordionShell>
  );
}
