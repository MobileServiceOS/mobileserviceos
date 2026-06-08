// src/components/ServiceIcon.tsx
// ═══════════════════════════════════════════════════════════════════
//  ServiceIcon — clean inline stroke icon per service type, replacing
//  the emoji from SERVICE_ICONS. Sized in `em` so it inherits whatever
//  font-size the call site set (the old emoji did the same), and
//  inherits currentColor. Unknown services fall back to the tire mark.
// ═══════════════════════════════════════════════════════════════════

import type { ReactNode } from 'react';

function S({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-0.125em' }}>
      {children}
    </svg>
  );
}

const Tire   = () => <S><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.2" /></S>;
const Wrench = () => <S><path d="M14.7 6.3a4 4 0 0 0-5.4 5.3l-6.6 6.6a1.5 1.5 0 1 0 2.1 2.1l6.6-6.6a4 4 0 0 0 5.3-5.4l-2.5 2.5-2-2 2.5-2.5z" /></S>;
const Rotate = () => <S><path d="M21 12a9 9 0 1 1-2.6-6.4" /><polyline points="21 3 21 9 15 9" /></S>;
const Unlock = () => <S><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.9-1" /></S>;
const Alert  = () => <S><path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12" y2="17.01" /></S>;
const Truck  = () => <S><rect x="1" y="3" width="15" height="13" rx="1" /><path d="M16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></S>;
const Zap    = () => <S><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></S>;
const Fuel   = () => <S><line x1="3" y1="22" x2="15" y2="22" /><line x1="4" y1="9" x2="14" y2="9" /><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18" /><path d="M14 13h2a2 2 0 0 1 2 2v1a2 2 0 0 0 4 0V9.8a2 2 0 0 0-.6-1.4L18 5" /></S>;
const Key    = () => <S><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 8.5-8.5" /><path d="m16.5 5.5 2.5 2.5" /></S>;

const MAP: Record<string, () => JSX.Element> = {
  'Flat Tire Repair': Wrench,
  'Tire Replacement': Tire,
  'Tire Installation': Tire,
  'Mounting & Balancing': Wrench,
  'Spare Tire Installation': Tire,
  'Spare Change': Rotate,
  'Tire Rotation': Rotate,
  'Wheel Lock Removal': Unlock,
  'Roadside Tire Assistance': Alert,
  'Mobile Tire Service': Truck,
  'Jump Start': Zap,
  'Fuel Delivery': Fuel,
  'Lockout': Key,
  'Fleet Tire Service': Truck,
  'Heavy-Duty Tire Service': Truck,
};

export function ServiceIcon({ name }: { name: string }): JSX.Element {
  const Ico = MAP[name] || Tire;
  return <Ico />;
}
