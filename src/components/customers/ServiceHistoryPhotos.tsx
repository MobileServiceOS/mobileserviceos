// src/components/customers/ServiceHistoryPhotos.tsx
// ═══════════════════════════════════════════════════════════════════
//  ServiceHistoryPhotos — aggregated photo grid grouped by service.
//
//  Spec: §"Service History Photos (refinement #7)"
//  Aggregates photo URLs from the customer's bounded 100-job window.
//  Groups by service type; tap → opens originating job.
// ═══════════════════════════════════════════════════════════════════

import { memo, useMemo, type CSSProperties } from 'react';
import type { Job } from '@/types';

interface Props {
  jobs: Job[];
  onJobClick?: (job: Job) => void;
}

function _groupPhotosByService(jobs: Job[]): Array<{
  service: string;
  items: Array<{ url: string; job: Job }>;
}> {
  const groups = new Map<string, Array<{ url: string; job: Job }>>();
  for (const j of jobs) {
    const photos = (j as unknown as { photos?: string[] }).photos;
    if (!Array.isArray(photos) || photos.length === 0) continue;
    const svc = j.service || 'Other';
    let group = groups.get(svc);
    if (!group) {
      group = [];
      groups.set(svc, group);
    }
    for (const url of photos) {
      if (typeof url === 'string' && url) group.push({ url, job: j });
    }
  }
  return Array.from(groups.entries()).map(([service, items]) => ({ service, items }));
}

function ServiceHistoryPhotosImpl({ jobs, onJobClick }: Props) {
  const groups = useMemo(() => _groupPhotosByService(jobs), [jobs]);
  const totalCount = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups]);

  if (totalCount === 0) return null;

  return (
    <section className="form-group card-anim" aria-label="Photos">
      <div className="form-group-title">Photos <span style={{ fontWeight: 400, color: 'var(--t3)', fontSize: 11 }}>({totalCount})</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {groups.map(g => (
          <div key={g.service}>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 6 }}>
              Last {g.service} photos ({g.items.length})
            </div>
            <div style={gridStyle}>
              {g.items.slice(0, 8).map((item, idx) => (
                <button
                  key={`${g.service}-${idx}`}
                  type="button"
                  onClick={() => onJobClick?.(item.job)}
                  style={thumbStyle}
                  aria-label={`Photo from ${g.service} job`}
                >
                  <img src={item.url} alt="" style={imgStyle} loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const gridStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6,
};
const thumbStyle: CSSProperties = {
  padding: 0, border: 'none', background: 'transparent',
  cursor: 'pointer', borderRadius: 6, overflow: 'hidden',
};
const imgStyle: CSSProperties = {
  width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block',
};

export const ServiceHistoryPhotos = memo(ServiceHistoryPhotosImpl);

export const __pureHooks = { groupPhotosByService: _groupPhotosByService };
