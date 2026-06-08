// src/components/NavIcons.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bottom-nav icon set — clean inline stroke icons replacing the emoji
//  (🏠📞📋👥🛞＋⚙). Inherit currentColor so the nav's active/inactive
//  amber/grey states + the active-scale transform just work. Sized 22px;
//  the Log "plus" is sized to sit inside its accent puck.
// ═══════════════════════════════════════════════════════════════════

function Svg({ children, size = 22 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const NavHome = () => (
  <Svg><path d="M3 9.5 12 3l9 6.5" /><path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" /></Svg>
);
export const NavLeads = () => (
  <Svg><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></Svg>
);
export const NavJobs = () => (
  <Svg><rect x="8" y="3" width="8" height="4" rx="1" /><path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" /><path d="M9 13h6M9 17h4" /></Svg>
);
export const NavCustomers = () => (
  <Svg><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Svg>
);
// Tire / wheel — concentric circles, fitting a mobile-tire business.
export const NavInventory = () => (
  <Svg><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.2" /></Svg>
);
export const NavLog = () => (
  <Svg size={22}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Svg>
);
export const NavMore = () => (
  <Svg><rect x="3" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" /></Svg>
);
