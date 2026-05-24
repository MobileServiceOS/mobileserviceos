import { useEffect, useState } from 'react';
import { subscribeSyncState, type SyncState } from '@/lib/syncState';

/**
 * React hook over the sync-state singleton. Returns the current
 * snapshot and re-renders the consumer whenever pending / acked /
 * failed counts change. Driven by fbSetFast.
 */
export function useSyncState(): SyncState {
  const [state, setState] = useState<SyncState>(() => ({
    pendingWrites: 0,
    lastSyncedAt: null,
    failedWrites: 0,
  }));
  useEffect(() => subscribeSyncState(setState), []);
  return state;
}
