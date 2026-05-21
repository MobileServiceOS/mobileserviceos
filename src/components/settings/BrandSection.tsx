import { useEffect, useRef, useState } from 'react';
import type { Brand } from '@/types';
import { useBrand } from '@/context/BrandContext';
import { CityStateSelect } from '@/components/CityStateSelect';
import { NumberField } from '@/components/NumberField';
import { addToast } from '@/lib/toast';
import { uploadLogo } from '@/lib/firebase';
import { APP_LOGO } from '@/lib/defaults';
import { normalizeHex } from '@/lib/utils';
import { AccordionShell } from '@/components/settings/AccordionShell';

/**
 * Hard cap on logo upload time. Firebase Storage retries internally,
 * but if the network never settles we still want to release the
 * spinner so the user isn't stuck. 30s is generous for a sub-MB image.
 */
const LOGO_UPLOAD_TIMEOUT_MS = 30_000;

// ─────────────────────────────────────────────────────────────────────
//  Brand accordion
// ─────────────────────────────────────────────────────────────────────

export function BrandAccordion({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { brand } = useBrand();
  const summary = [
    brand.businessName || 'Unnamed business',
    [brand.mainCity, brand.state].filter(Boolean).join(', ') || '—',
  ].join(' · ');

  return (
    <AccordionShell
      title="Brand"
      icon="🎨"
      summary={summary}
      open={open}
      onToggle={onToggle}
      logoUrl={brand.logoUrl}
    >
      <BrandForm />
    </AccordionShell>
  );
}

function BrandForm() {
  const { brand, businessId, updateBrand } = useBrand();
  const [draft, setDraft] = useState<Brand>(brand);
  const [dirty, setDirty] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  // Dirty-aware re-sync. BrandContext's snapshot listener emits a NEW
  // brand object on every Firestore round-trip, including:
  //   - The optimistic update after our own save
  //   - Background writes (e.g. subscription-mirror, services-backfill)
  //   - Any other tab modifying the same doc
  // Resetting draft unconditionally meant any of those would wipe a
  // user's in-progress edit. This is the production "I edit and it
  // goes right back" bug on Wheel Rush. Guard with `dirty`: only
  // re-sync when the user has no unsaved changes.
  useEffect(() => {
    if (!dirty) setDraft(brand);
  }, [brand, dirty]);

  const set = <K extends keyof Brand>(k: K, v: Brand[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };

  /**
   * Logo upload with a hard timeout so the spinner can never get stuck.
   * Promise.race against a setTimeout rejection — whichever settles
   * first wins. The `finally` block guarantees state cleanup on every
   * branch (success / error / timeout). Toast feedback on each outcome.
   */
  const handleLogo = async (file: File) => {
    if (!businessId) { addToast('Sign in required', 'warn'); return; }
    if (logoUploading) return;
    setLogoUploading(true);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      // `uploadLogo` returns `Promise<string | null>` (null on a quietly-
      // skipped upload). The timeout race arm must use the same union
      // so the generic type-checks; we narrow back to a non-null string
      // at the use site below.
      const url = await Promise.race<string | null>([
        uploadLogo(businessId, file),
        new Promise<string | null>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Logo upload timed out — please try again')),
            LOGO_UPLOAD_TIMEOUT_MS,
          );
        }),
      ]);
      if (url) {
        // Logo upload auto-saves immediately. Use setDraft directly
        // (not the dirty-setting `set` helper) so the form doesn't
        // think the user has unsaved changes after a successful
        // upload — there's nothing left to save.
        setDraft((d) => ({ ...d, logoUrl: url }));
        await updateBrand({ logoUrl: url });
        addToast('Logo updated', 'success');
      } else {
        addToast('Upload returned no URL', 'error');
      }
    } catch (e) {
      addToast((e as Error).message || 'Upload failed', 'error');
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setLogoUploading(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      // Normalize colors at the save boundary so Firestore only ever
      // holds canonical `#rrggbb`. Why: the legacy text input lets
      // users type bare hex ("c8a44a") or invalid strings, which then
      // failed `isValidHex` at apply time and silently produced no
      // visual change after a "Brand saved" toast — the root cause of
      // the Wheel Rush "can't change color" report.
      const cleanDraft: Brand = {
        ...draft,
        primaryColor: normalizeHex(draft.primaryColor, '#c8a44a'),
        accentColor: normalizeHex(draft.accentColor, '#e5c770'),
      };
      await updateBrand(cleanDraft);
      setDraft(cleanDraft);
      setDirty(false);
      addToast('Brand saved', 'success');
    } catch (e) {
      addToast((e as Error).message || 'Save failed', 'error');
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="field">
        <label>Logo</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={draft.logoUrl || APP_LOGO} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'contain', background: 'var(--s3)' }} />
          <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogo(f); if (logoInputRef.current) logoInputRef.current.value = ''; }} />
          <button className="btn sm secondary" onClick={() => logoInputRef.current?.click()} disabled={logoUploading}>
            {logoUploading ? 'Uploading…' : 'Upload logo'}
          </button>
        </div>
        {!draft.logoUrl && !logoUploading && (
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
            Logo appears on invoices and customer-facing receipts. PNG or
            JPG, square preferred.
          </div>
        )}
      </div>
      <div className="field">
        <label>Business name</label>
        <input value={draft.businessName} onChange={(e) => set('businessName', e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Phone</label>
          <input type="tel" value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
        </div>
      </div>
      <CityStateSelect
        state={draft.state || ''}
        city={draft.mainCity || ''}
        onChange={({ city, state, fullLocationLabel }) => {
          setDraft((d) => ({ ...d, mainCity: city, state, fullLocationLabel }));
          setDirty(true);
        }}
        cityLabel="Main city" stateLabel="State"
      />
      <div className="field" style={{ marginTop: 14 }}>
        <label>Service cities (comma-separated)</label>
        <input
          value={(draft.serviceCities || []).join(', ')}
          onChange={(e) => set('serviceCities', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Service radius (mi)</label>
          <NumberField
            value={draft.serviceRadius || 25}
            onChange={(n) => set('serviceRadius', n)}
            decimals={false}
            placeholder="25"
          />
        </div>
        <div className="field">
          <label>Review URL</label>
          <input value={draft.reviewUrl} onChange={(e) => set('reviewUrl', e.target.value)} placeholder="https://g.page/r/…" />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Primary color</label>
          <ColorPicker
            value={draft.primaryColor}
            onChange={(v) => set('primaryColor', v)}
            fallback="#c8a44a"
          />
        </div>
        <div className="field">
          <label>Accent color</label>
          <ColorPicker
            value={draft.accentColor}
            onChange={(v) => set('accentColor', v)}
            fallback="#e5c770"
          />
        </div>
      </div>
      <button className="btn primary" onClick={save} disabled={busy} style={{ width: '100%' }}>
        {busy ? 'Saving…' : 'Save Brand'}
      </button>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  ColorPicker
// ─────────────────────────────────────────────────────────────────────
//  Curated palette of brand-ready swatches as the primary input. One
//  tap = brand color, no hex knowledge required. Native HTML5 picker
//  and hex input remain as power-user fallbacks. Why: field operators
//  on mobile don't carry their brand book — they recognize "the gold
//  one" or "the red one" instantly.
// ─────────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#c8a44a', // gold
  '#e5c770', // light gold
  '#dc2626', // red
  '#ea580c', // orange
  '#f59e0b', // amber
  '#16a34a', // green
  '#0891b2', // teal
  '#2563eb', // blue
  '#7c3aed', // purple
  '#db2777', // pink
  '#475569', // slate
  '#0f172a', // near-black
];

function ColorPicker({
  value, onChange, fallback,
}: { value: string; onChange: (v: string) => void; fallback: string }) {
  const hex = normalizeHex(value, fallback);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: 6,
      }}>
        {PRESET_COLORS.map((preset) => {
          const selected = hex.toLowerCase() === preset.toLowerCase();
          return (
            <button
              key={preset}
              type="button"
              onClick={() => onChange(preset)}
              aria-label={`Choose ${preset}`}
              style={{
                width: '100%',
                aspectRatio: '1 / 1',
                background: preset,
                border: selected
                  ? '3px solid var(--t1)'
                  : '1px solid var(--border)',
                borderRadius: 8,
                cursor: 'pointer',
                padding: 0,
                boxShadow: selected ? '0 0 0 2px var(--s2)' : 'none',
              }}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 44, height: 44, padding: 0, border: '1px solid var(--border)',
            borderRadius: 8, cursor: 'pointer', background: 'transparent',
          }}
          aria-label="Custom color"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={fallback}
          style={{ flex: 1, fontFamily: 'monospace' }}
        />
      </div>
    </div>
  );
}

