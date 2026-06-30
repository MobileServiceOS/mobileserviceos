// src/components/settings/ThemeToggle.tsx
// Appearance toggle — Dark (default) vs Light. Persists to localStorage
// and applies instantly (see src/lib/theme.ts).
import { useState } from 'react';
import { getStoredTheme, setTheme, type ThemeName } from '@/lib/theme';
import { syncStatusBarToTheme } from '@/lib/native';

export function ThemeToggle() {
  const [theme, setThemeState] = useState<ThemeName>(getStoredTheme);
  const pick = (t: ThemeName) => { setThemeState(t); setTheme(t); void syncStatusBarToTheme(); };

  return (
    <div className="card card-anim" style={{ marginBottom: 12 }}>
      <div className="card-pad" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--t1)' }}>Appearance</div>
          <div style={{ fontSize: 11, color: 'var(--t3)' }}>Dark or light — saved on this device.</div>
        </div>
        <div role="group" aria-label="Theme" style={{
          display: 'flex', border: '1px solid var(--border)', borderRadius: 99, overflow: 'hidden', flexShrink: 0,
        }}>
          {(['dark', 'light'] as ThemeName[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={theme === t}
              onClick={() => pick(t)}
              style={{
                padding: '8px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer', border: 'none',
                background: theme === t ? 'var(--brand-primary)' : 'transparent',
                color: theme === t ? '#0a0a0a' : 'var(--t2)',
              }}
            >
              {t === 'dark' ? '🌙 Dark' : '☀️ Light'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
