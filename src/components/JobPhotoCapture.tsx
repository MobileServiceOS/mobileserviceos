import { useRef, useState } from 'react';
import { compressImage } from '@/lib/imageCompress';
import { uploadJobPhoto } from '@/lib/firebase';
import { addToast } from '@/lib/toast';

// ─────────────────────────────────────────────────────────────────────
//  JobPhotoCapture — multi-photo upload + camera-capture entry.
//  Designed to live inside JobDetailModal (and optionally AddJob).
//
//  Uses a hidden <input type="file" accept="image/*" capture> so
//  iOS / Android both surface the native camera shortcut alongside
//  the library picker. multiple=true lets the operator pick a few
//  before/after shots in one go.
//
//  Per file:
//    1. compressImage to ~1600px / 0.82 quality JPEG (5–10 MB → 200–500 KB)
//    2. uploadJobPhoto to businesses/{bid}/job-photos/{jobId}/{ts}.jpg
//    3. push the resulting download URL into the local list + bubble
//       up via onChange so the parent can persist to Firestore.
//
//  Renders a 3-column thumbnail grid with a remove button on each
//  thumb, plus a big "+ Add photos" button at the bottom.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  businessId: string;
  jobId: string;
  photos: string[];
  onChange: (next: string[]) => void;
  /** Disables the add button (e.g. while parent is mid-save). */
  disabled?: boolean;
  /** Max photos per job. Default 12 — enough for tire walkarounds. */
  max?: number;
}

export function JobPhotoCapture({
  businessId, jobId, photos, onChange, disabled, max = 12,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = max - photos.length;
    if (remaining <= 0) {
      addToast(`Up to ${max} photos per job`, 'warn');
      return;
    }
    const picked = Array.from(files).slice(0, remaining);
    setBusy(true);
    setProgress({ done: 0, total: picked.length });
    const uploaded: string[] = [];
    for (const file of picked) {
      try {
        const compressed = await compressImage(file, { maxDim: 1600, quality: 0.82 });
        const url = await uploadJobPhoto(businessId, jobId, compressed.blob);
        if (url) uploaded.push(url);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[photo-capture] upload failed (non-fatal):', err);
        addToast('A photo failed to upload. Try again.', 'warn');
      } finally {
        setProgress((p) => p ? { ...p, done: p.done + 1 } : null);
      }
    }
    if (uploaded.length > 0) {
      onChange([...photos, ...uploaded]);
      addToast(`${uploaded.length} photo${uploaded.length === 1 ? '' : 's'} added`, 'success');
    }
    setBusy(false);
    setProgress(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const removeAt = (idx: number) => {
    // Note: this removes the URL from the job doc; the underlying
    // Storage blob is NOT garbage-collected. For v1 that's
    // acceptable (operator rarely re-removes) — a future cleanup
    // pass could call deleteObject() when the URL is removed.
    const next = photos.filter((_, i) => i !== idx);
    onChange(next);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => { void handleFiles(e.target.files); }}
      />

      {photos.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          marginBottom: 10,
        }}>
          {photos.map((url, i) => (
            <div
              key={url + i}
              style={{
                position: 'relative',
                aspectRatio: '1 / 1',
                borderRadius: 8,
                overflow: 'hidden',
                border: '1px solid var(--border)',
                background: 'var(--s3)',
              }}
            >
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'block', width: '100%', height: '100%' }}
                aria-label={`View photo ${i + 1} full size`}
              >
                <img
                  src={url}
                  alt={`Job photo ${i + 1}`}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </a>
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`Remove photo ${i + 1}`}
                style={{
                  position: 'absolute', top: 4, right: 4,
                  width: 22, height: 22, borderRadius: 999,
                  background: 'rgba(0,0,0,0.65)', color: '#fff',
                  border: 'none', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', lineHeight: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="btn sm secondary"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy || photos.length >= max}
        style={{ width: '100%' }}
      >
        {busy && progress
          ? `Uploading… ${progress.done} / ${progress.total}`
          : photos.length === 0
            ? '📷 Add photos'
            : photos.length >= max
              ? `Max ${max} photos`
              : `📷 Add more (${photos.length} / ${max})`}
      </button>
    </>
  );
}
