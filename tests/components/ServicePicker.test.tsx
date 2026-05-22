// tests/components/ServicePicker.test.tsx
// Integration test for the AddJob service picker — a real component
// rendered into jsdom, driven by real clicks/typing. ServicePicker
// takes plain props (no Firebase, no context) so it tests cleanly
// end-to-end with zero mocking.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServicePicker } from '@/components/addJob/ServicePicker';
import type { BusinessTypeService } from '@/config/businessTypes/registry';

const mk = (
  id: string,
  category?: string,
  popular?: boolean,
): BusinessTypeService => ({
  id, label: id, defaultBasePrice: 0, defaultMinProfit: 0,
  enabledByDefault: true, category, popular,
});

// Tire-style: short list, no categories → FLAT mode.
const flat: BusinessTypeService[] = [
  mk('Flat Tire Repair'),
  mk('Tire Replacement'),
];

// Mechanic-style: categorized → GROUPED mode. Category names are
// kept distinct from every service label so getByText queries are
// unambiguous in the assertions below.
const grouped: BusinessTypeService[] = [
  mk('Computer Scan', 'Engine', true),
  mk('Oil Change', 'Fluids', true),
  mk('Brake Pads & Rotors', 'Brakes'),
  mk('Radiator Replacement', 'Cooling'),
];

describe('ServicePicker — flat mode (tire / detailing)', () => {
  it('renders every enabled service as a chip', () => {
    render(
      <ServicePicker
        services={flat}
        enabledIds={['Flat Tire Repair', 'Tire Replacement']}
        selected=""
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('Flat Tire Repair')).toBeInTheDocument();
    expect(screen.getByText('Tire Replacement')).toBeInTheDocument();
    // Flat mode shows no search box.
    expect(screen.queryByPlaceholderText('Search services…')).toBeNull();
  });

  it('fires onSelect with the chosen id', async () => {
    const onSelect = vi.fn();
    render(
      <ServicePicker
        services={flat}
        enabledIds={['Flat Tire Repair', 'Tire Replacement']}
        selected=""
        onSelect={onSelect}
      />,
    );
    await userEvent.click(screen.getByText('Tire Replacement'));
    expect(onSelect).toHaveBeenCalledWith('Tire Replacement');
  });

  it('respects enabledIds — a disabled service is not rendered', () => {
    render(
      <ServicePicker
        services={flat}
        enabledIds={['Flat Tire Repair']}
        selected=""
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('Flat Tire Repair')).toBeInTheDocument();
    expect(screen.queryByText('Tire Replacement')).toBeNull();
  });
});

describe('ServicePicker — grouped mode (mechanic)', () => {
  const enabledIds = grouped.map((s) => s.id);

  it('shows the search box + a Popular section', () => {
    render(
      <ServicePicker
        services={grouped}
        enabledIds={enabledIds}
        selected=""
        onSelect={() => {}}
      />,
    );
    expect(screen.getByPlaceholderText('Search services…')).toBeInTheDocument();
    expect(screen.getByText('Popular')).toBeInTheDocument();
  });

  it('starts with categories collapsed — a non-popular service is hidden', () => {
    render(
      <ServicePicker
        services={grouped}
        enabledIds={enabledIds}
        selected=""
        onSelect={() => {}}
      />,
    );
    // 'Brake Pads & Rotors' is in the collapsed 'Brakes' category and
    // is not popular → not visible until the category is opened.
    expect(screen.queryByText('Brake Pads & Rotors')).toBeNull();
    // Popular services ARE visible.
    expect(screen.getByText('Computer Scan')).toBeInTheDocument();
    expect(screen.getByText('Oil Change')).toBeInTheDocument();
  });

  it('expands a category on tap, revealing its services', async () => {
    render(
      <ServicePicker
        services={grouped}
        enabledIds={enabledIds}
        selected=""
        onSelect={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Brakes/ }));
    expect(screen.getByText('Brake Pads & Rotors')).toBeInTheDocument();
  });

  it('search flattens results across all categories', async () => {
    render(
      <ServicePicker
        services={grouped}
        enabledIds={enabledIds}
        selected=""
        onSelect={() => {}}
      />,
    );
    await userEvent.type(screen.getByPlaceholderText('Search services…'), 'radiator');
    // The matching service surfaces even though Cooling was collapsed.
    expect(screen.getByText('Radiator Replacement')).toBeInTheDocument();
    // Non-matching popular services drop out of the result list.
    expect(screen.queryByText('Computer Scan')).toBeNull();
  });

  it('auto-expands the category holding the current selection', () => {
    render(
      <ServicePicker
        services={grouped}
        enabledIds={enabledIds}
        selected="Brake Pads & Rotors"
        onSelect={() => {}}
      />,
    );
    // 'Brakes' should be open on mount because the selection lives there.
    expect(screen.getByText('Brake Pads & Rotors')).toBeInTheDocument();
  });

  it('fires onSelect from a popular chip', async () => {
    const onSelect = vi.fn();
    render(
      <ServicePicker
        services={grouped}
        enabledIds={enabledIds}
        selected=""
        onSelect={onSelect}
      />,
    );
    await userEvent.click(screen.getByText('Oil Change'));
    expect(onSelect).toHaveBeenCalledWith('Oil Change');
  });
});
