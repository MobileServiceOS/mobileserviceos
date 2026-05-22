// tests/components/aiClient.test.ts
// ───────────────────────────────────────────────────────────────────
//  Unit tests for src/lib/aiClient.ts — the browser-side AI proxy
//  client. Firebase and the env seam are mocked; fetch is stubbed.
//
//  The proxy URL is read through src/lib/env.ts precisely so it can
//  be mocked here — Vite inlines `import.meta.env` per module, which
//  is otherwise impossible to vary from a test.
// ───────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mutable test state — created via vi.hoisted so it exists when the
// hoisted vi.mock factories run.
const { mockAuth, mockEnv } = vi.hoisted(() => ({
  mockAuth: {
    currentUser: null as { getIdToken: () => Promise<string> } | null,
  },
  mockEnv: { proxyUrl: '' },
}));

vi.mock('@/lib/firebase', () => ({ _auth: mockAuth }));
vi.mock('@/lib/env', () => ({ aiProxyUrl: () => mockEnv.proxyUrl }));

import { isAIConfigured, callAI } from '@/lib/aiClient';

const PROXY = 'https://proxy.test/ai';

beforeEach(() => {
  mockAuth.currentUser = null;
  mockEnv.proxyUrl = '';
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isAIConfigured', () => {
  it('is false when no proxy URL is set', () => {
    expect(isAIConfigured()).toBe(false);
  });

  it('is true when a proxy URL is set', () => {
    mockEnv.proxyUrl = PROXY;
    expect(isAIConfigured()).toBe(true);
  });
});

describe('callAI', () => {
  it('returns ai_not_configured when no proxy URL is set', async () => {
    const res = await callAI('ping');
    expect(res).toEqual({ ok: false, error: 'ai_not_configured' });
  });

  it('returns not_signed_in when there is no current user', async () => {
    mockEnv.proxyUrl = PROXY;
    mockAuth.currentUser = null;
    const res = await callAI('ping');
    expect(res).toEqual({ ok: false, error: 'not_signed_in' });
  });

  it('returns the proxy text on a successful call', async () => {
    mockEnv.proxyUrl = PROXY;
    mockAuth.currentUser = { getIdToken: async () => 'id-token-123' };

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, text: 'pong' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await callAI('ping', { foo: 1 });
    expect(res).toEqual({ ok: true, text: 'pong' });

    // Verifies the request carries the bearer token and payload.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(PROXY);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer id-token-123');
    expect(JSON.parse(init.body as string)).toEqual({ task: 'ping', input: { foo: 1 } });
  });

  it('surfaces the proxy error on a non-2xx response', async () => {
    mockEnv.proxyUrl = PROXY;
    mockAuth.currentUser = { getIdToken: async () => 'id-token-123' };

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'proxy_misconfigured' }),
    })));

    const res = await callAI('ping');
    expect(res).toEqual({ ok: false, error: 'proxy_misconfigured' });
  });

  it('returns network_error when fetch rejects', async () => {
    mockEnv.proxyUrl = PROXY;
    mockAuth.currentUser = { getIdToken: async () => 'id-token-123' };

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));

    const res = await callAI('ping');
    expect(res).toEqual({ ok: false, error: 'network_error' });
  });
});
