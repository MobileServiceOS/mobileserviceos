// src/lib/round.ts
// ═══════════════════════════════════════════════════════════════════
//  Dependency-free rounding helpers. Lives in its own file so config
//  modules inside the registry's transitive value-import tree
//  (tire.ts, mechanic.ts, detailing.ts) can use them without dragging
//  in `@/lib/utils` — which transitively imports `@/lib/verticals`
//  and closes a circular ES-module dependency back to the registry.
//
//  In Vite dev that cycle resolves via live bindings, but the
//  production Rollup bundle re-orders accesses in a way that trips
//  the temporal dead zone ("Cannot access 'Jt' before initialization"
//  on app.mobileserviceos.app). Importing only from this leaf module
//  keeps the registry's load order clean.
//
//  Do NOT add any imports here. This file must remain a leaf.
// ═══════════════════════════════════════════════════════════════════

export const r2 = (n: number): number => Math.round(n * 100) / 100;
