import { useBrand } from '@/context/BrandContext';
import { APP_LOGO } from '@/lib/defaults';
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
    case 'connected':
      return { label: '● Synced', className: 'sync-pill synced', title: 'All changes synced to cloud' };
    case 'syncing':
      return { label: '○ Syncing', className: 'sync-pill syncing', title: 'Syncing with Firestore' };
    case 'offline':
      return { label: '⚠ Offline', className: 'sync-pill offline', title: 'No internet — changes queued' };
    case 'sync_failed':
      return { label: '✕ Failed', className: 'sync-pill failed', title: 'Sync failed — see console' };
    case 'local':
    default:
      return { label: '○ Local', className: 'sync-pill local', title: 'Local-only — not yet synced' };
  }
}

export function Header({ syncStatus, onSignOut }: Props) {
  const { brand } = useBrand();
  const logoSrc = brand.logoUrl || APP_LOGO;
  const pill = statusPill(syncStatus);

  return (
    <div className="header-compact">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
        <img
          src={logoSrc}
          alt=""
          style={{
            width: 32,
            height: 32,
            objectFit: 'contain',
            borderRadius: 9,
            flexShrink: 0,
            boxShadow: '0 2px 10px rgba(0,0,0,.5), 0 0 0 1px rgba(200,164,74,.18)',
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).src = APP_LOGO;
          }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {brand.businessName || 'Mobile Service OS'}
          </h1>
          <p style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {[brand.businessType, brand.serviceArea].filter(Boolean).join(' · ') || 'Mobile Tire & Roadside'}
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span className={pill.className} title={pill.title}>
          {pill.label}
        </span>
        <button
          onClick={onSignOut}
          title="Sign out"
          style={{
            background: 'var(--s3)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            width: 32,
            height: 32,
            minHeight: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            color: 'var(--t2)',
            padding: 0,
          }}
        >
          ⎋
        </button>
      </div>
    </div>
  );
}
