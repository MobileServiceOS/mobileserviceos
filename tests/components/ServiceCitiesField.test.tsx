// tests/components/ServiceCitiesField.test.tsx
// Service-cities chip multiselect: autocomplete suggest + select, manual
// entry (incl. cities not in the DB), dedupe, and graceful empty state.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ServiceCitiesField } from '@/components/settings/ServiceCitiesField';

function setup(value: string[] = []) {
  const onChange = vi.fn();
  render(<ServiceCitiesField value={value} onChange={onChange} state="FL" />);
  const input = screen.getByRole('textbox');
  return { onChange, input };
}

describe('ServiceCitiesField', () => {
  it('suggests matching cities as you type', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: 'Hia' } });
    // "Hialeah" is a real FL city in the autocomplete DB.
    expect(screen.getByRole('option', { name: 'Hialeah' })).toBeInTheDocument();
  });

  it('adds a city when a suggestion is selected', () => {
    const { input, onChange } = setup(['Miami']);
    fireEvent.change(input, { target: { value: 'Hia' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Hialeah' }));
    expect(onChange).toHaveBeenCalledWith(['Miami', 'Hialeah']);
  });

  it('adds a manually-typed city on Enter even if not in the DB', () => {
    const { input, onChange } = setup([]);
    // "West Park" is a real CDP but not in the suggestion list — manual entry must work.
    fireEvent.change(input, { target: { value: 'west park' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['West Park']); // title-cased
  });

  it('adds on comma (pasting/typing a separator)', () => {
    const { input, onChange } = setup([]);
    fireEvent.change(input, { target: { value: 'doral,' } });
    expect(onChange).toHaveBeenCalledWith(['Doral']);
  });

  it('dedupes case-insensitively (no duplicate chip)', () => {
    const { input, onChange } = setup(['Miami Gardens']);
    fireEvent.change(input, { target: { value: 'miami gardens' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Already present (case-insensitive) → onChange not called with a dup.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders existing cities as removable chips', () => {
    const { onChange } = setup(['Miami', 'Doral']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Doral' }));
    expect(onChange).toHaveBeenCalledWith(['Miami']);
  });

  it('degrades gracefully — manual entry still works with no state', () => {
    const onChange = vi.fn();
    render(<ServiceCitiesField value={[]} onChange={onChange} state="" />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Aventura' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['Aventura']);
  });
});
