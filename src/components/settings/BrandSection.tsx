import { useRef, useState } from 'react';
import type { Brand } from '@/types';
import { useBrand } from '@/context/BrandContext';
import { CityStateSelect } from '@/components/CityStateSelect';
import { ServiceCitiesField } from '@/components/settings/ServiceCitiesField';
import { NumberField } from '@/components/NumberField';
import { normalizeServiceCities } from '@/lib/locations';
import { addToast } from '@/lib/toast';
import { enqueueLogoUpload } from '@/lib/uploadQueue';
import { APP_LOGO } from '@/lib/defaults';
import { normalizeHex } from '@/lib/utils';
import { contrastRatio, WCAG_AA_NORMAL, APP_DARK_BG_HEX } from '@/lib/colorContrast';
import { useDirtyDraft } from '@/lib/useDirtyDraft';
import { AccordionShell } from '@/components/settings/AccordionShell';
import { BrandPreview } from '@/components/settings/BrandPreview';

/**
 * Hard cap on logo upload time. Firebase Storage retries internally,
 * but if the network never settles we still want to release the
 * spinner so the user isn't stuck. 30s is generous for a sub-MB image.
 */
const LOGO_UPLOAD_TIMEOUT_MS = 30_000;

/**
 * Downscale the uploaded logo File to a small PNG data URI (≤256px). Stored
 * as brand.logoDataUri so generated PDFs can embed the logo directly — a data
 * URI needs no network/CORS, unlike the Firebase Storage URL which the
 * browser can't read into a canvas (the reason the logo dropped from
 * invoices/estimates). The source is a local File (same-origin blob), so the
 * canvas isn't tainted and toDataURL succeeds. Resolves null on any failure.
 */
function fileToLogoDataUri(file: File, maxDim = 256): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
          const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
          const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png'));
        } catch { resolve(null); }
      };
      img.src = typeof reader.result === 'string' ? reader.result : '';
    };
    reader.readAsDataURL(file);
  });
}

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
    // Build the embeddable data URI from the local File up front — it's
    // independent of the Storage upload and is what makes the logo appear on
    // PDFs (no CORS). Persisted alongside logoUrl in every branch below.
    const logoDataUri = await fileToLogoDataUri(file);
    const dataUriPatch = logoDataUri ? { logoDataUri } : {};
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
        replace({ ...draft, logoUrl: url, ...dataUriPatch }, false);
        await updateBrand({ logoUrl: url, ...dataUriPatch });
        addToast('Logo updated', 'success');
      } else {
        // Queued offline. Show a local preview so the user sees the
        // change immediately; the queue patches settings/main on drain.
        // Persist the data URI now (it doesn't need the upload) so the PDF
        // logo works even before the Storage write drains.
        const localUrl = URL.createObjectURL(file);
        replace({ ...draft, logoUrl: localUrl, ...dataUriPatch }, false);
        if (logoDataUri) await updateBrand(dataUriPatch);
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
        // Trim / title-case / dedupe service cities so "Miami gardens" and
        // "Miami Gardens" never both persist.
        serviceCities: normalizeServiceCities(draft.serviceCities),
      };
      // A session-only blob: preview URL must never reach Firestore — it's
      // dead on the next page load and renders as a broken image (the root
      // cause of the "logo broken" report). Drop it; the upload queue patches
      // the real Storage URL into settings/main when it drains.
      if (cleanDraft.logoUrl?.startsWith('blob:')) cleanDraft.logoUrl = '';
      // Audit a11y P1-5 (2026-05-31): reject brand colors that render
      // illegibly on the dark app surface. The brand primary is used
      // as text colour on `--s1` backgrounds (banner copy, KPI hints,
      // suggested-price labels) — if its contrast is below WCAG AA
      // (4.5:1) the entire branded UI becomes invisible. Operators
      // who pick a near-black slate from the preset palette were
      // silently producing this state.
      const primaryContrast = contrastRatio(cleanDraft.primaryColor, APP_DARK_BG_HEX);
      if (primaryContrast < WCAG_AA_NORMAL) {
        addToast(
          `Primary color contrast too low (${primaryContrast.toFixed(1)}:1) — pick a lighter or more saturated shade for legible branded text.`,
          'error',
        );
        setBusy(false);
        return;
      }
      const accentContrast = contrastRatio(cleanDraft.accentColor, APP_DARK_BG_HEX);
      if (accentContrast < WCAG_AA_NORMAL) {
        addToast(
          `Accent color contrast too low (${accentContrast.toFixed(1)}:1) — pick a lighter shade for legible accents.`,
          'error',
        );
        setBusy(false);
        return;
      }
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
        <label htmlFor="settings-logo-upload">Logo</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={draft.logoUrl || APP_LOGO} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'contain', background: 'var(--s3)' }}
            onError={(e) => { const t = e.currentTarget; if (!t.src.endsWith(APP_LOGO)) t.src = APP_LOGO; }} />
          <input id="settings-logo-upload" ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }}
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
        <label htmlFor="settings-business-name">Business name</label>
        <input id="settings-business-name" value={draft.businessName} onChange={(e) => set('businessName', e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="settings-tagline">Tagline</label>
        <input
          id="settings-tagline"
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
          <label htmlFor="settings-brand-phone">Phone</label>
          <input id="settings-brand-phone" type="tel" value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="settings-brand-email">Email</label>
          <input id="settings-brand-email" type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
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
      <ServiceCitiesField
        value={draft.serviceCities || []}
        onChange={(next) => set('serviceCities', next)}
        state={draft.state || ''}
      />
      <div className="field-row">
        <div className="field">
          <label htmlFor="settings-service-radius">Service radius (mi)</label>
          <NumberField
            id="settings-service-radius"
            value={draft.serviceRadius || 25}
            onChange={(n) => set('serviceRadius', n)}
            decimals={false}
            placeholder="25"
          />
        </div>
        <div className="field">
          <label htmlFor="settings-review-url">Review URL</label>
          <input id="settings-review-url" value={draft.reviewUrl} onChange={(e) => set('reviewUrl', e.target.value)} placeholder="https://g.page/r/…" />
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
          <label id="settings-primary-color-label">Primary color</label>
          <ColorPicker
            value={draft.primaryColor}
            onChange={(v) => set('primaryColor', v)}
            fallback="#f4b400"
            ariaLabelledBy="settings-primary-color-label"
          />
        </div>
        <div className="field">
          <label id="settings-accent-color-label">Accent color</label>
          <ColorPicker
            value={draft.accentColor}
            onChange={(v) => set('accentColor', v)}
            fallback="#f7ca4d"
            ariaLabelledBy="settings-accent-color-label"
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
  value, onChange, fallback, ariaLabelledBy,
}: { value: string; onChange: (v: string) => void; fallback: string; ariaLabelledBy?: string }) {
  const hex = normalizeHex(value, fallback);
  return (
    // a11y: when the parent provides a label id via ariaLabelledBy,
    // expose the picker as a labeled group. AT users hear the visible
    // "Primary color" / "Accent color" label as the picker's name.
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      role={ariaLabelledBy ? 'group' : undefined}
      aria-labelledby={ariaLabelledBy}
    >
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

