// tests/components/SizeLink.test.tsx
// The shared "tap a size → open it in Inventory" link used everywhere.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SizeLink, SizeLinkProvider, useSizeLinkNav } from '@/components/SizeLink';

describe('SizeLink', () => {
  it('renders nothing for an empty size', () => {
    const { container } = render(<SizeLink size="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the size as static text when no provider is mounted', () => {
    render(<SizeLink size="225/55R18" />);
    // Static span — not a button.
    expect(screen.getByText('225/55R18')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('calls the navigator with the size when clicked (provider mounted)', () => {
    const onOpen = vi.fn();
    render(
      <SizeLinkProvider onOpen={onOpen}>
        <SizeLink size="235/45R18" />
      </SizeLinkProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /235\/45R18/ }));
    expect(onOpen).toHaveBeenCalledWith('235/45R18');
  });

  it('stops propagation so the surrounding row/card does not also fire', () => {
    const onOpen = vi.fn();
    const onRowClick = vi.fn();
    render(
      <SizeLinkProvider onOpen={onOpen}>
        <div onClick={onRowClick}>
          <SizeLink size="205/55R16" />
        </div>
      </SizeLinkProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /205\/55R16/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('as="span" renders a role=link (safe inside an outer button)', () => {
    const onOpen = vi.fn();
    render(
      <SizeLinkProvider onOpen={onOpen}>
        <SizeLink size="215/60R17" as="span" />
      </SizeLinkProvider>,
    );
    const link = screen.getByRole('link', { name: /215\/60R17/ });
    expect(link.tagName).toBe('SPAN');
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledWith('215/60R17');
  });

  it('useSizeLinkNav returns the navigator inside a provider, null outside', () => {
    let captured: unknown = 'unset';
    function Probe() { captured = useSizeLinkNav(); return null; }
    const fn = vi.fn();
    render(<SizeLinkProvider onOpen={fn}><Probe /></SizeLinkProvider>);
    expect(typeof captured).toBe('function');

    render(<Probe />);
    expect(captured).toBeNull();
  });
});
