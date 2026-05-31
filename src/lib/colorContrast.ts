// ─────────────────────────────────────────────────────────────────────
//  colorContrast — WCAG 2.1 contrast-ratio helpers.
//
//  Audit a11y P1-5 (2026-05-31): owners can pick any hex via the
//  brand-color picker. The picker presets include near-black slates
//  (e.g. #0f172a) which render brand-tinted UI (banner accents,
//  "Suggested" hints, brand-button labels) at ~1.1:1 contrast against
//  the dark app surface — visually invisible. This module exposes
//  ratio + AA threshold checks so BrandSection can reject sub-AA
//  choices at save time with a clear error.
//
//  Coverage: WCAG 2.1 §1.4.3 contrast minimum (AA). The AAA tier
//  (7:1) is intentionally NOT enforced — operators need branding
//  flexibility and the AA threshold (4.5:1 for ≤17px normal, 3:1 for
//  ≥18px or bold ≥14px) is the standard regulatory bar.
// ─────────────────────────────────────────────────────────────────────

/** Parse a `#rrggbb` (or `rrggbb`) hex into an RGB triple. Returns
 *  null for malformed input — callers should normalize via
 *  normalizeHex() in utils.ts first. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace(/^#/, '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  };
}

/** Relative luminance per WCAG 2.1 §1.4.3 definition. Input: 0-255
 *  RGB. Output: 0..1 luminance value. */
function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const channel = (raw: number): number => {
    const v = raw / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** Contrast ratio between two hex colors per WCAG 2.1. Returns a
 *  value in [1, 21]. Returns 1 (worst case) on parse failure so
 *  callers default to rejecting unrecognized input. */
export function contrastRatio(fgHex: string, bgHex: string): number {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  if (!fg || !bg) return 1;
  const Lfg = relativeLuminance(fg);
  const Lbg = relativeLuminance(bg);
  const lighter = Math.max(Lfg, Lbg);
  const darker = Math.min(Lfg, Lbg);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA threshold for normal-weight text ≤17px. The most common
 *  size on MSOS surfaces (KPI tiles, suggested-price hints, banner
 *  copy) is 11-14px, so this is the right gate for the brand-color
 *  validation. */
export const WCAG_AA_NORMAL = 4.5;

/** WCAG AA threshold for ≥18px regular or ≥14px bold. Larger text
 *  can use a looser bar. Exposed for any future use site that opts in;
 *  the brand-color save path enforces the stricter NORMAL threshold. */
export const WCAG_AA_LARGE = 3.0;

/** App background surfaces, kept in sync with src/styles/app.css
 *  CSS custom properties --s1, --s2, --s3. Brand-tinted UI renders
 *  on top of one of these three; the brand color must pass AA
 *  against the DARKEST of them (--s1) to be guaranteed legible
 *  everywhere it appears. */
export const APP_DARK_BG_HEX = '#111315' as const;
