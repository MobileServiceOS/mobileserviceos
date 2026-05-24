// src/components/OfflineBanner.tsx
// ═══════════════════════════════════════════════════════════════════
//  Offline reassurance strip. Firestore's persistentLocalCache
//  already queues writes offline and re-syncs on reconnect — this
//  banner just makes that VISIBLE so a tech in a dead zone trusts
//  that nothing is being lost.
//
//   • offline      → persistent amber strip
//   • reconnected  → green "back online" strip for RECONNECT_MS,
//                     then auto-hides
//   • otherwise    → renders nothing
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import type { SyncStatus } from '@/types';
import { useSyncState } from '@/lib/useSyncState';

interface Props {
  syncStatus: SyncStatus;
}

type Mode = 'hidden' | 'offline' | 'reconnected';

const RECONNECT_MS = 3000;

export function OfflineBanner({ syncStatus }: Props) {
  const [mode, setMode] = useState<Mode>(
    syncStatus === 'offline' ? 'offline' : 'hidden',
  );
  // Tracks whether the PREVIOUS status was offline, so we can
  // detect the offline → online transition.
  const wasOffline = useRef(syncStatus === 'offline');
  const { pendingWrites } = useSyncState();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (syncStatus === 'offline') {
      setMode('offline');
      wasOffline.current = true;
    } else if (wasOffline.current) {
      // Just came back from offline — show the reconnect note
      // briefly, then hide.
      wasOffline.current = false;
      setMode('reconnected');
      timer = setTimeout(() => setMode('hidden'), RECONNECT_MS);
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [syncStatus]);

  if (mode === 'hidden') return null;

  const reconnected = mode === 'reconnected';
  // Live "queued" count — increments every time fbSetFast issues a
  // write while offline, drops back to 0 as the SDK drains the
  // queue on reconnect. Surfaced so the tech sees their changes
  // are tracked, not lost.
  const queued = pendingWrites > 0 ? ` · ${pendingWrites} change${pendingWrites === 1 ? '' : 's'} queued` : '';
  return (
    <div
      className={'offline-banner' + (reconnected ? ' reconnected' : '')}
      role="status"
      aria-live="polite"
    >
      {reconnected
        ? `✓ Back online — syncing your changes…${queued}`
        : `⚠ Offline — your work is saved on this device and syncs automatically when you reconnect.${queued}`}
    </div>
  );
}
