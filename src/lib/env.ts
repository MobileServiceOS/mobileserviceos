// src/lib/env.ts
// ═══════════════════════════════════════════════════════════════════
//  Single chokepoint for build-time environment variables.
//
//  Vite inlines `import.meta.env` PER MODULE — each module gets its
//  own frozen snapshot, so a test cannot mutate one module's env and
//  have another module see it. Centralizing the reads here gives the
//  rest of the app a mockable seam: tests `vi.mock('@/lib/env')`.
// ═══════════════════════════════════════════════════════════════════

const env = (import.meta as ImportMeta & {
  env: Record<string, string | undefined>;
}).env;

/** AI proxy Worker URL, or '' when AI features are not configured. */
export function aiProxyUrl(): string {
  return (env.VITE_AI_PROXY_URL || '').trim();
}
