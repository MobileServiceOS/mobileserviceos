// src/config/theme.js
export const COLORS = {
  primary:    '#ea580c',
  primaryDark:'#c2410c',
  dark:       '#111111',
  surface:    '#ffffff',
  bg:         '#f8f8f8',
  border:     '#e8e8e8',
  muted:      '#888888',
  mutedLight: '#bbbbbb',
  success:    '#16a34a',
  error:      '#dc2626',
  warning:    '#d97706',
  info:       '#2563eb',
};

export const FONTS = {
  mono: "'SF Mono', 'Fira Code', 'Courier New', monospace",
};

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
};

export const SHADOW = {
  card: '0 1px 4px rgba(0,0,0,0.06)',
  modal:'0 8px 32px rgba(0,0,0,0.18)',
};

// Shared inline style helpers
export const card = (extra={}) => ({
  background: '#fff',
  borderRadius: RADIUS.lg,
  border: `1px solid ${COLORS.border}`,
  boxShadow: SHADOW.card,
  ...extra,
});

export const btn = (variant='primary', extra={}) => {
  const base = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer',
    borderRadius: RADIUS.md, padding: '14px 20px', border: 'none',
    fontFamily: 'inherit', transition: 'opacity .15s',
  };
  const variants = {
    primary:  { background: COLORS.primary, color: '#fff' },
    secondary:{ background: COLORS.bg, color: COLORS.dark, border: `1.5px solid ${COLORS.border}` },
    danger:   { background: '#fee2e2', color: COLORS.error },
    ghost:    { background: 'transparent', color: COLORS.muted, border: 'none' },
    dark:     { background: COLORS.dark, color: '#fff' },
  };
  return { ...base, ...variants[variant], ...extra };
};

export const input = (extra={}) => ({
  width: '100%', padding: '13px 14px', fontSize: 15,
  border: `1.5px solid ${COLORS.border}`, borderRadius: RADIUS.md,
  background: '#fff', color: COLORS.dark, outline: 'none',
  fontFamily: 'inherit',
  ...extra,
});

export const label = (extra={}) => ({
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.6px', color: COLORS.muted, marginBottom: 6,
  display: 'block',
  ...extra,
});
