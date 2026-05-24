import { useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────
//  SignaturePad — pointer-events canvas. Captures a signature and
//  exports it as a PNG data URL the caller persists on the job for
//  the invoice PDF to embed.
//
//  Designed for tap-and-hold field use: pointer events (works on
//  mouse, touch, and stylus identically), pen-thickness ~2px,
//  ink color matches --t1 (white in dark theme, black in light).
//
//  Renders inside its container at the container's width × 200px.
//  Internal canvas uses devicePixelRatio for crisp ink. Export
//  trims to the canvas bitmap; caller can store the data URL on
//  the job doc directly (typical size 5-20 KB).
// ─────────────────────────────────────────────────────────────────────

interface Props {
  onCapture: (dataUrl: string) => void;
  onCancel?: () => void;
  /** Initial data URL — when provided, the pad opens already
   *  populated and the operator can either re-sign or accept. */
  initial?: string;
  /** Height in CSS pixels. Default 180. */
  height?: number;
}

export function SignaturePad({ onCapture, onCancel, initial, height = 180 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(Boolean(initial));

  // Set up canvas at devicePixelRatio for crisp ink.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const cssW = wrap.clientWidth;
    const cssH = height;
    canvas.style.width  = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.4;
    // Ink color — read from --t1 so the signature shows in any theme.
    const inkColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--t1').trim() || '#fff';
    ctx.strokeStyle = inkColor;

    // Paint the initial data URL if provided.
    if (initial) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, cssW, cssH);
      img.src = initial;
    }
  }, [height, initial]);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastRef.current = pointFromEvent(e);
  };

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    const last = lastRef.current;
    if (!ctx || !last) return;
    const next = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    lastRef.current = next;
    if (!hasInk) setHasInk(true);
  };

  const handleUp = () => {
    drawingRef.current = false;
    lastRef.current = null;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  };

  const accept = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Export as PNG to preserve the transparent background.
    const dataUrl = canvas.toDataURL('image/png');
    onCapture(dataUrl);
  };

  return (
    <div ref={wrapRef} style={{ width: '100%' }}>
      <div style={{
        fontSize: 11, color: 'var(--t3)', marginBottom: 6, lineHeight: 1.4,
      }}>
        Sign with your finger or stylus inside the box.
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onPointerLeave={handleUp}
        style={{
          width: '100%',
          height,
          background: 'var(--s2)',
          border: '1px dashed var(--border)',
          borderRadius: 10,
          touchAction: 'none',
          cursor: 'crosshair',
          display: 'block',
        }}
      />
      <div style={{
        display: 'flex', gap: 8, marginTop: 10,
      }}>
        <button
          type="button"
          className="btn sm secondary"
          onClick={clear}
          disabled={!hasInk}
          style={{ flex: 1 }}
        >
          Clear
        </button>
        {onCancel && (
          <button
            type="button"
            className="btn sm ghost"
            onClick={onCancel}
            style={{ flex: 1 }}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          className="btn sm primary"
          onClick={accept}
          disabled={!hasInk}
          style={{ flex: 2 }}
        >
          Save Signature
        </button>
      </div>
    </div>
  );
}
