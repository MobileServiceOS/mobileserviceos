// tests/components/useBreakpoint.test.tsx
// Mobile-first responsive seam — verifies the breakpoint resolves
// correctly at phone, tablet, and desktop widths.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { resolveBreakpoint, useBreakpoint, BP_QUERIES } from '@/lib/useBreakpoint';

afterEach(() => { vi.unstubAllGlobals(); });

function stubMatchMedia(matching: string[]) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: matching.includes(q),
    media: q,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function Probe() { return <span data-testid="bp">{useBreakpoint()}</span>; }

describe('resolveBreakpoint (pure)', () => {
  it('mobile when nothing matches', () => {
    expect(resolveBreakpoint(() => false)).toBe('mobile');
  });
  it('tablet when only the tablet query matches', () => {
    expect(resolveBreakpoint((q) => q === BP_QUERIES.tablet)).toBe('tablet');
  });
  it('desktop when the desktop query matches (wins over tablet)', () => {
    expect(resolveBreakpoint(() => true)).toBe('desktop');
  });
});

describe('useBreakpoint (matchMedia)', () => {
  it('phone width → mobile', () => {
    stubMatchMedia([]);
    render(<Probe />);
    expect(screen.getByTestId('bp')).toHaveTextContent('mobile');
  });

  it('tablet width → tablet', () => {
    stubMatchMedia([BP_QUERIES.tablet]);
    render(<Probe />);
    expect(screen.getByTestId('bp')).toHaveTextContent('tablet');
  });

  it('desktop width → desktop', () => {
    stubMatchMedia([BP_QUERIES.tablet, BP_QUERIES.desktop]);
    render(<Probe />);
    expect(screen.getByTestId('bp')).toHaveTextContent('desktop');
  });

  it('falls back to mobile when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    render(<Probe />);
    expect(screen.getByTestId('bp')).toHaveTextContent('mobile');
  });
});
