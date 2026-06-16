// tests/components/Skeleton.test.tsx
// Loading placeholders — shown instead of a blank screen while a page
// or its data loads.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton, SkeletonCard, PageSkeleton } from '@/components/Skeleton';

describe('Skeleton', () => {
  it('renders a shimmer block with the .skeleton class', () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelector('.skeleton')).toBeInTheDocument();
  });

  it('SkeletonCard renders the requested number of lines + a title', () => {
    const { container } = render(<SkeletonCard lines={4} />);
    // 1 title + 4 lines = 5 skeleton blocks.
    expect(container.querySelectorAll('.skeleton')).toHaveLength(5);
  });

  it('PageSkeleton exposes a loading status to assistive tech', () => {
    render(<PageSkeleton cards={2} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
