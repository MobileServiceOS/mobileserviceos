// Shared types for the Wheel Rush supplier-pricing backend.
//
// PRIVACY: nothing here references supplier credentials or session
// tokens. Those live only inside connector implementations and are
// sourced from defineSecret() at the Cloud Functions entry point.

export type SupplierName = 'ATD' | 'Advance Tire' | 'U.S. AutoForce';

// 'all' (everyone) or a specific supplier passthrough filter.
export type SupplierFilter = 'all' | SupplierName;

export type TierKey = 'cheapest' | 'mid' | 'premium';

// A single tire offer from a supplier. This is the sanitized shape the
// connector is allowed to surface to the client — no portal HTML, no
// session cookies, no auth tokens, no internal request IDs.
export interface SupplierTireResult {
  supplier: SupplierName;
  brand: string;
  model: string;
  size: string;             // normalized form, e.g. "225/45R17"
  cost: number;             // wholesale cost (USD) per tire
  quantityAvailable: number;
  eta: string;              // human label: "Today" | "Tomorrow" | "2-3 days"
  runFlat?: boolean;
  xlLoad?: boolean;
  speedRating?: string;     // e.g. "W", "Y", "H", "V"
  loadIndex?: string;       // e.g. "94", "97"
  notes?: string;
}

export interface SearchRequest {
  tireSize: string;                  // raw input — any supported format
  quantity?: number;                 // default 1; clamped 1..20 server-side
  supplierFilter?: SupplierFilter;   // default 'all'
}

export interface TierBundle {
  cheapest: SupplierTireResult | null;
  mid: SupplierTireResult | null;
  premium: SupplierTireResult | null;
}

export interface SearchResponse {
  normalizedSize: string;
  tiers: TierBundle;
  allResults: SupplierTireResult[];  // sorted cheapest → highest cost
  warnings: string[];                // "ATD unavailable" etc. — never internal errors
}

// Every supplier exposes this contract. Phase 1 connectors return mock
// data; Phase 2 will swap the body for real HTTP/Playwright while
// keeping this signature stable so the orchestrator never changes.
export interface SupplierConnector {
  name: SupplierName;
  searchByTireSize(
    normalizedSize: string,
    quantity: number
  ): Promise<SupplierTireResult[]>;
}
