// tests/components/ConfirmDialog.test.tsx
// Integration test for the styled confirm dialog that replaces
// window.confirm() in Team Management — focuses on the async feedback
// the native confirm can't give: busy state, close-on-success, and
// stay-open-on-failure for retry.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfirmDialog } from '@/components/ConfirmDialog';

afterEach(() => { vi.restoreAllMocks(); });

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('ConfirmDialog', () => {
  it('renders the title, body, and confirm label', () => {
    render(
      <ConfirmDialog title="Remove member?" body={<span>bye</span>} confirmLabel="Remove"
        onConfirm={async () => {}} onClose={() => {}} />,
    );
    expect(screen.getByText('Remove member?')).toBeInTheDocument();
    expect(screen.getByText('bye')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('shows the busy label and disables buttons while confirming, then closes on success', async () => {
    const d = deferred();
    const onConfirm = vi.fn(() => d.promise);
    const onClose = vi.fn();
    render(
      <ConfirmDialog title="Transfer ownership?" body="x" confirmLabel="Transfer"
        busyLabel="Transferring…" onConfirm={onConfirm} onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Transfer' }));

    // Mid-flight: busy label shown, both buttons disabled, not yet closed.
    expect(screen.getByRole('button', { name: 'Transferring…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    d.resolve();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('stays open (re-enabled) when the action throws, so the user can retry', async () => {
    const d = deferred();
    const onConfirm = vi.fn(() => d.promise);
    const onClose = vi.fn();
    render(
      <ConfirmDialog title="Revoke invite?" body="x" confirmLabel="Revoke"
        busyLabel="Revoking…" onConfirm={onConfirm} onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    d.reject(new Error('network'));

    // Button re-enables to its idle label; dialog NOT closed.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke' })).not.toBeDisabled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancel closes without running the action', () => {
    const onConfirm = vi.fn(async () => {});
    const onClose = vi.fn();
    render(
      <ConfirmDialog title="t" body="x" confirmLabel="Go" onConfirm={onConfirm} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
