// tests/components/BrandPreview.test.tsx
// Integration test for the live brand preview — a pure-props
// component, rendered into jsdom with no mocking.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandPreview } from '@/components/settings/BrandPreview';

describe('BrandPreview', () => {
  it('shows the business name (in both mockups)', () => {
    render(
      <BrandPreview
        businessName="Wheel Rush"
        tagline=""
        logoUrl=""
        primaryColor="#f4b400"
      />,
    );
    // Appears in the app-header mockup AND the invoice mockup.
    expect(screen.getAllByText('Wheel Rush').length).toBe(2);
  });

  it('falls back to a placeholder name when blank', () => {
    render(
      <BrandPreview businessName="" tagline="" logoUrl="" primaryColor="#f4b400" />,
    );
    expect(screen.getAllByText('Your Business').length).toBe(2);
  });

  it('shows the tagline when set', () => {
    render(
      <BrandPreview
        businessName="Wheel Rush"
        tagline="Roadside tire help, fast"
        logoUrl=""
        primaryColor="#f4b400"
      />,
    );
    // Tagline shows in the header mockup + the invoice mockup.
    expect(screen.getAllByText('Roadside tire help, fast').length).toBe(2);
  });

  it('omits the invoice tagline line when tagline is empty', () => {
    render(
      <BrandPreview businessName="Wheel Rush" tagline="" logoUrl="" primaryColor="#f4b400" />,
    );
    // Empty tagline → the header mockup shows the generic
    // "Mobile Service" placeholder, and the invoice mockup omits
    // its tagline line entirely (no real tagline text anywhere).
    expect(screen.queryByText('Roadside tire help, fast')).toBeNull();
    expect(screen.getByText('Mobile Service')).toBeInTheDocument();
  });

  it('renders without crashing on a half-typed (invalid) hex', () => {
    // normalizeHex must absorb a mid-edit value — no throw.
    expect(() =>
      render(
        <BrandPreview businessName="X" tagline="" logoUrl="" primaryColor="#f4b" />,
      ),
    ).not.toThrow();
  });
});
