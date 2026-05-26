import { useRef, useState } from 'react';
import type { Brand } from '@/types';
import { useBrand } from '@/context/BrandContext';
import { CityStateSelect } from '@/components/CityStateSelect';
import { NumberField } from '@/components/NumberField';
import { addToast } from '@/lib/toast';
import { enqueueLogoUpload } from '@/lib/uploadQueue';
import { APP_LOGO } from '@/lib/defaults';
import { normalizeHex } from '@/lib/utils';
import { useDirtyDraft } from '@/lib/useDirtyDraft';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { BrandPreview } from '@/components/settings/BrandPreview';

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
  // Dirty-aware draft sync. See useDirtyDraft — same pattern that
  // fixes the Wheel Rush "settings revert" bug across the four
  // settings sections.
  const { draft, set, patch, replace } = useDirtyDraft<Brand>(brand);
  const [logoUploading, setLogoUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

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
        enqueueLogoUpload(businessId, file),
        new Promise<string | null>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Logo upload timed out — please try again')),
            LOGO_UPLOAD_TIMEOUT_MS,
          );
        }),
      ]);
      if (url) {
        // Logo upload auto-saves immediately. patch with markDirty=false
        // semantics via replace, so the form doesn't think the user has
        // unsaved changes after a successful upload.
        replace({ ...draft, logoUrl: url }, false);
        await updateBrand({ logoUrl: url });
        addToast('Logo updated', 'success');
      } else {
        // Queued offline. Show a local preview so the user sees the
        // change immediately; the queue patches settings/main on drain.
        const localUrl = URL.createObjectURL(file);
        replace({ ...draft, logoUrl: localUrl }, false);
        addToast('Logo queued — uploads when online', 'info');
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
        primaryColor: normalizeHex(draft.primaryColor, '#f4b400'),
        accentColor: normalizeHex(draft.accentColor, '#f7ca4d'),
      };
      await updateBrand(cleanDraft);
      // replace(_, false) — both updates the local draft to the
      // canonicalized values AND marks clean in one call. Matches
      // the post-save "what's on disk now matches what we hold"
      // invariant.
      replace(cleanDraft, false);
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
      <div className="field">
        <label>Tagline</label>
        <input
          value={draft.tagline}
          onChange={(e) => set('tagline', e.target.value)}
          placeholder="e.g. Roadside tire help, fast"
        />
        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
          Shows under your business name in the app header and on invoices.
        </div>
      </div>

      <BrandPreview
        businessName={draft.businessName}
        tagline={draft.tagline}
        logoUrl={draft.logoUrl}
        primaryColor={draft.primaryColor}
      />

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
        onChange={({ city, state, fullLocationLabel }) =>
          patch({ mainCity: city, state, fullLocationLabel })
        }
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
      {/* Review automation toggle. undefined is treated as ON, so an
          existing brand with no value still gets the prompt. */}
      <div className="field">
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={draft.autoReviewPrompt !== false}
            onChange={(e) => set('autoReviewPrompt', e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            <span style={{ fontWeight: 700, color: 'var(--t1)' }}>Auto-prompt for a review after payment</span>
            <span style={{ display: 'block', fontSize: 11, color: 'var(--t3)', marginTop: 3, lineHeight: 1.5 }}>
              When a job is marked paid, a one-tap “Send review” button
              appears in the confirmation. Needs a Review URL set above.
            </span>
          </span>
        </label>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Primary color</label>
          <ColorPicker
            value={draft.primaryColor}
            onChange={(v) => set('primaryColor', v)}
            fallback="#f4b400"
          />
        </div>
        <div className="field">
          <label>Accent color</label>
          <ColorPicker
            value={draft.accentColor}
            onChange={(v) => set('accentColor', v)}
            fallback="#f7ca4d"
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
  '#f4b400', // brand amber
  '#f7ca4d', // light amber
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

