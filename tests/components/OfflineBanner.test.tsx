// tests/components/OfflineBanner.test.tsx
// Integration test for the offline reassurance banner.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OfflineBanner } from '@/components/OfflineBanner';

afterEach(() => {
  vi.useRealTimers();
});

describe('OfflineBanner', () => {
  it('shows the reassurance strip when offline', () => {
    render(<OfflineBanner syncStatus="offline" />);
    expect(screen.getByText(/Offline/)).toBeInTheDocument();
    expect(screen.getByText(/saved on this device/)).toBeInTheDocument();
  });

  it('renders nothing when connected with no prior offline', () => {
    const { container } = render(<OfflineBanner syncStatus="connected" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for the plain "local" status', () => {
    const { container } = render(<OfflineBanner syncStatus="local" />);
    expect(container.firstChild).toBeNull();
  });

  it('on reconnect shows "Back online", then hides after the timer', () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<OfflineBanner syncStatus="offline" />);
    expect(screen.getByText(/Offline/)).toBeInTheDocument();

    // Connectivity returns.
    rerender(<OfflineBanner syncStatus="syncing" />);
    expect(screen.getByText(/Back online/)).toBeInTheDocument();

    // After the reconnect window, the banner self-hides.
    vi.advanceTimersByTime(3100);
    rerender(<OfflineBanner syncStatus="syncing" />);
    expect(container.firstChild).toBeNull();
  });

  it('uses the reconnected style class on the back-online strip', () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<OfflineBanner syncStatus="offline" />);
    rerender(<OfflineBanner syncStatus="connected" />);
    const strip = container.querySelector('.offline-banner');
    expect(strip).not.toBeNull();
    expect(strip?.classList.contains('reconnected')).toBe(true);
  });
});
