// tests/shareFile.spec.ts
// Run: npx vitest run tests/shareFile.spec.ts
//
// canShareFiles decides whether the quote/invoice PDF can attach to a
// message via the native share sheet (vs. download + SMS-text fallback).

import { describe, it, expect, vi } from 'vitest';
import { canShareFiles } from '@/lib/shareFile';

const pdf = () => new File([new Blob(['%PDF'], { type: 'application/pdf' })], 'q.pdf', { type: 'application/pdf' });

function navWith(over: Partial<Navigator>): Navigator {
  return over as Navigator;
}

describe('canShareFiles', () => {
  it('true when share + canShare(files) are supported and accept the file', () => {
    const nav = navWith({ share: vi.fn(), canShare: vi.fn().mockReturnValue(true) } as Partial<Navigator>);
    expect(canShareFiles(nav, pdf())).toBe(true);
  });

  it('false when canShare rejects the file (e.g. desktop without file sharing)', () => {
    const nav = navWith({ share: vi.fn(), canShare: vi.fn().mockReturnValue(false) } as Partial<Navigator>);
    expect(canShareFiles(nav, pdf())).toBe(false);
  });

  it('false when navigator.share is missing', () => {
    const nav = navWith({ canShare: vi.fn().mockReturnValue(true) } as Partial<Navigator>);
    expect(canShareFiles(nav, pdf())).toBe(false);
  });

  it('false when canShare is missing', () => {
    const nav = navWith({ share: vi.fn() } as Partial<Navigator>);
    expect(canShareFiles(nav, pdf())).toBe(false);
  });

  it('false when navigator is undefined (SSR)', () => {
    expect(canShareFiles(undefined, pdf())).toBe(false);
  });

  it('passes the actual file to canShare', () => {
    const canShare = vi.fn().mockReturnValue(true);
    const nav = navWith({ share: vi.fn(), canShare } as Partial<Navigator>);
    const f = pdf();
    canShareFiles(nav, f);
    expect(canShare).toHaveBeenCalledWith({ files: [f] });
  });
});
