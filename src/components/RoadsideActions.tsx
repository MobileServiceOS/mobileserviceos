// src/components/RoadsideActions.tsx
// ═══════════════════════════════════════════════════════════════════
//  RoadsideActions — native Call / Text / Navigate buttons for the
//  field. Rendered as <a> with tel: / sms: / maps URIs so the phone's
//  OS handles the action directly. Big, high-contrast, thumb-friendly,
//  one-handed. No emoji — clean inline SVG icons (premium).
// ═══════════════════════════════════════════════════════════════════

import type { CSSProperties } from 'react';

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);
const ChatIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);
const NavIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="3 11 22 2 13 21 11 13 3 11" />
  </svg>
);

export function RoadsideActions({
  phoneE164, address, style,
}: {
  phoneE164?: string | null;
  address?: string | null;
  style?: CSSProperties;
}): JSX.Element | null {
  const tel = phoneE164 ? phoneE164.replace(/[^\d+]/g, '') : '';
  const navQuery = address && address.trim() ? encodeURIComponent(address.trim()) : '';
  if (!tel && !navQuery) return null;
  return (
    <div className="roadside-row" style={{ marginBottom: 12, ...style }}>
      {tel && (
        <a className="roadside-link call" href={`tel:${tel}`} aria-label="Call">
          <PhoneIcon /> Call
        </a>
      )}
      {tel && (
        <a className="roadside-link text" href={`sms:${tel}`} aria-label="Text">
          <ChatIcon /> Text
        </a>
      )}
      {navQuery && (
        <a className="roadside-link nav"
          href={`https://www.google.com/maps/search/?api=1&query=${navQuery}`}
          target="_blank" rel="noreferrer" aria-label="Navigate">
          <NavIcon /> Navigate
        </a>
      )}
    </div>
  );
}
