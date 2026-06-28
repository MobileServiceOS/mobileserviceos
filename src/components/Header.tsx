import { useBrand } from '@/context/BrandContext';
import { useActiveVertical } from '@/lib/useActiveVertical';
import { useMembership } from '@/context/MembershipContext';
import { useSyncState } from '@/lib/useSyncState';
import { presenceRelative } from '@/lib/presenceTime';
import { APP_LOGO } from '@/lib/defaults';
import { BusinessSwitcher } from '@/components/BusinessSwitcher';
import { StatusSwitcher } from '@/components/StatusSwitcher';
import type { SyncStatus } from '@/types';

interface Props {
  syncStatus: SyncStatus;
  onSignOut: () => void;
}

interface PillSpec {
  label: string;
  className: string;
  title: string;
}

function statusPill(s: SyncStatus): PillSpec {
  switch (s) {
    case 'connected':   return { label: '● Synced',  className: 'sync-pill synced',  title: 'All changes synced to cloud' };
    case 'syncing':     return { label: '○ Syncing', className: 'sync-pill syncing', title: 'Syncing with Firestore' };
    case 'offline':     return { label: '⚠ Offline', className: 'sync-pill offline', title: 'No internet — changes queued' };
    case 'sync_failed': return { label: '✕ Failed',  className: 'sync-pill failed',  title: 'Sync failed — see console' };
    case 'local':
    default:            return { label: '○ Local',   className: 'sync-pill local',   title: 'Local-only — not yet synced' };
  }
}

export function Header({ syncStatus, onSignOut }: Props) {
  const { brand, businessId } = useBrand();
  const vertical = useActiveVertical();
  const { role } = useMembership();
  const pill = statusPill(syncStatus);
  // Techs see a work-status switcher in place of the sync pill —
  // it's the field-service rhythm they live in. Owners + admins keep
  // the sync pill since their concern is data integrity, not
  // dispatch state.
  const isTechnician = role === 'technician';
  // Live sync detail — pending write count + last-synced timestamp
  // shown in the pill tooltip + appended to its label when pending.
  const { pendingWrites, lastSyncedAt, failedWrites } = useSyncState();
  const tooltip = (() => {
    const parts = [pill.title];
    if (pendingWrites > 0) {
      parts.push(`${pendingWrites} change${pendingWrites === 1 ? '' : 's'} queued`);
    }
    if (lastSyncedAt) {
      parts.push(`Last synced ${presenceRelative(lastSyncedAt)}`);
    }
    if (failedWrites > 0) {
      parts.push(`${failedWrites} write${failedWrites === 1 ? '' : 's'} failed`);
    }
    return parts.join(' · ');
  })();
  const labelSuffix = pendingWrites > 0 ? ` (${pendingWrites})` : '';

  return (
    <div className="header-compact">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
        <img
          src={brand.logoDataUri || brand.logoUrl || APP_LOGO}
          alt=""
          style={{
            width: 32, height: 32, objectFit: 'contain', borderRadius: 9, flexShrink: 0,
            boxShadow: '0 2px 10px rgba(0,0,0,.5), 0 0 0 1px rgba(200,164,74,.18)',
          }}
          onError={(e) => { const t = e.currentTarget; if (!t.src.endsWith(APP_LOGO)) t.src = APP_LOGO; }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {brand.businessName || 'Mobile Service OS'}
          </h1>
          <p style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {/* The operator's chosen tagline wins when set; otherwise
                fall back to the vertical + service-area descriptor. */}
            {(brand.tagline || '').trim()
              || [vertical.displayName, brand.serviceArea].filter(Boolean).join(' · ')
              || 'Mobile Tire & Roadside'}
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {/* BusinessSwitcher renders only when the user owns more than
            one business. For a single-business operator it returns
            null and the Header is visually unchanged. */}
        <BusinessSwitcher activeLabel={brand.businessName || 'Mobile Service OS'} />
        {isTechnician
          ? <StatusSwitcher businessId={businessId} />
          : <span className={pill.className} title={tooltip}>{pill.label}{labelSuffix}</span>}
        <button
          onClick={onSignOut}
          title="Sign out"
          style={{
            background: 'var(--s3)', border: '1px solid var(--border)', borderRadius: 8,
            width: 32, height: 32, minHeight: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, color: 'var(--t2)', padding: 0,
          }}
        >⎋</button>
      </div>
    </div>
  );
}
