// src/components/settings/BrandPreview.tsx
// ═══════════════════════════════════════════════════════════════════
//  Live brand preview for Settings → Brand. Pure props — renders
//  two mockups (app header + invoice header) from the in-progress
//  draft so the operator sees their composed brand BEFORE saving.
//
//  Colors run through normalizeHex so a half-typed hex in the
//  draft can never break the preview.
// ═══════════════════════════════════════════════════════════════════

import { normalizeHex } from '@/lib/utils';
import { APP_LOGO } from '@/lib/defaults';

interface Props {
  businessName: string;
  tagline: string;
  logoUrl: string;
  primaryColor: string;
}

export function BrandPreview({ businessName, tagline, logoUrl, primaryColor }: Props) {
  const color = normalizeHex(primaryColor, '#f4b400');
  const logo = logoUrl || APP_LOGO;
  const name = businessName.trim() || 'Your Business';
  const tag = tagline.trim();

  return (
    <div className="field">
      <label>Preview</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* App-header mockup */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--s2)',
          border: '1px solid var(--border)',
          borderRadius: 10, padding: '10px 12px',
        }}>
          <img
            src={logo} alt=""
            style={{
              width: 32, height: 32, borderRadius: 9, objectFit: 'contain',
              flexShrink: 0, boxShadow: `0 0 0 1px ${color}55`,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 14, fontWeight: 700, color: 'var(--t1)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{name}</div>
            <div style={{
              fontSize: 11, color: 'var(--t3)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{tag || 'Mobile Service'}</div>
          </div>
        </div>

        {/* Invoice-header mockup */}
        <div style={{
          border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden',
        }}>
          <div style={{ height: 6, background: color }} />
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#ffffff', padding: '12px 14px',
          }}>
            <img
              src={logo} alt=""
              style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'contain', flexShrink: 0 }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 15, fontWeight: 800, color: '#0a0a0a',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{name}</div>
              {tag && (
                <div style={{
                  fontSize: 10, color: '#6b7280',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{tag}</div>
              )}
              <div style={{
                fontSize: 9, fontWeight: 700, letterSpacing: 1,
                textTransform: 'uppercase', color,
              }}>Invoice</div>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 10, color: 'var(--t3)' }}>
          Live preview — reflects unsaved edits above.
        </div>
      </div>
    </div>
  );
}
