import { SupplierConnector, SupplierTireResult } from './supplierTypes';

// ATD (American Tire Distributors) connector.
//
// Phase 1: returns a hand-curated mock catalog for the most common
// passenger sizes. The SKUs, brand names, costs, quantities, and ETAs
// are realistic — sourced from current ATD-typical wholesale price
// bands — so downstream UI/QA work feels like the live integration.
//
// Phase 2 (TODO): replace catalog reads with real ATD portal calls.
//   - Auth flow: ATD's dealer portal does not publish an open API.
//     Real integration requires partner approval + business credentials.
//     Once obtained, replace this file's body with an authenticated
//     HTTP client (or Playwright if no API is offered).
//   - Secrets to consume: ATD_USERNAME, ATD_PASSWORD (already wired
//     into the parent onCall function's `secrets` array).
//   - Session strategy: cache the auth token in module scope with
//     ~50% expiry margin; re-auth on 401.
//   - Errors: throw any error — the orchestrator catches per-supplier
//     failures and surfaces a sanitized "ATD unavailable" warning.

const ATD_CATALOG: SupplierTireResult[] = [
  // 225/45R17
  { supplier: 'ATD', size: '225/45R17', brand: 'Lexani', model: 'LXUHP-207',
    cost: 72, quantityAvailable: 8, eta: 'Today', xlLoad: true, speedRating: 'W' },
  { supplier: 'ATD', size: '225/45R17', brand: 'Lionhart', model: 'Sleek SPORT',
    cost: 78, quantityAvailable: 12, eta: 'Today', speedRating: 'W' },
  { supplier: 'ATD', size: '225/45R17', brand: 'Kumho', model: 'Ecsta PA51',
    cost: 118, quantityAvailable: 4, eta: 'Today', xlLoad: true, speedRating: 'W' },
  { supplier: 'ATD', size: '225/45R17', brand: 'Cooper', model: 'Discoverer SRX',
    cost: 132, quantityAvailable: 6, eta: 'Today', speedRating: 'V' },
  { supplier: 'ATD', size: '225/45R17', brand: 'Continental', model: 'ExtremeContact DWS06+',
    cost: 169, quantityAvailable: 3, eta: 'Today', xlLoad: true, speedRating: 'Y',
    notes: '70k warranty' },
  { supplier: 'ATD', size: '225/45R17', brand: 'Michelin', model: 'Pilot Sport All Season 4',
    cost: 198, quantityAvailable: 2, eta: 'Tomorrow', xlLoad: true, speedRating: 'Y' },

  // 225/65R17
  { supplier: 'ATD', size: '225/65R17', brand: 'Westlake', model: 'SU318',
    cost: 78, quantityAvailable: 10, eta: 'Today', speedRating: 'H' },
  { supplier: 'ATD', size: '225/65R17', brand: 'Ironman', model: 'iMOVE GEN3',
    cost: 88, quantityAvailable: 8, eta: 'Today', speedRating: 'H' },
  { supplier: 'ATD', size: '225/65R17', brand: 'Cooper', model: 'Discoverer SRX',
    cost: 142, quantityAvailable: 4, eta: 'Today', speedRating: 'H' },
  { supplier: 'ATD', size: '225/65R17', brand: 'Goodyear', model: 'Assurance MaxLife',
    cost: 168, quantityAvailable: 6, eta: 'Today', speedRating: 'H',
    notes: '85k warranty' },
  { supplier: 'ATD', size: '225/65R17', brand: 'Michelin', model: 'CrossClimate2',
    cost: 218, quantityAvailable: 2, eta: 'Tomorrow', speedRating: 'V' },

  // 235/55R18
  { supplier: 'ATD', size: '235/55R18', brand: 'Ironman', model: 'iMOVE GEN3',
    cost: 92, quantityAvailable: 6, eta: 'Today', speedRating: 'V' },
  { supplier: 'ATD', size: '235/55R18', brand: 'Milestar', model: 'MS932 Sport',
    cost: 99, quantityAvailable: 8, eta: 'Today', xlLoad: true, speedRating: 'V' },
  { supplier: 'ATD', size: '235/55R18', brand: 'Cooper', model: 'Discoverer SRX',
    cost: 158, quantityAvailable: 4, eta: 'Today', speedRating: 'V' },
  { supplier: 'ATD', size: '235/55R18', brand: 'Yokohama', model: 'Avid Touring-S',
    cost: 175, quantityAvailable: 3, eta: 'Today', speedRating: 'V' },
  { supplier: 'ATD', size: '235/55R18', brand: 'Michelin', model: 'Premier LTX',
    cost: 232, quantityAvailable: 2, eta: 'Tomorrow', speedRating: 'H' },

  // 245/40R18
  { supplier: 'ATD', size: '245/40R18', brand: 'Lionhart', model: 'LH-503',
    cost: 88, quantityAvailable: 10, eta: 'Today', xlLoad: true, speedRating: 'W' },
  { supplier: 'ATD', size: '245/40R18', brand: 'Kumho', model: 'Ecsta PA51',
    cost: 138, quantityAvailable: 4, eta: 'Today', xlLoad: true, speedRating: 'W' },
  { supplier: 'ATD', size: '245/40R18', brand: 'Hankook', model: 'Ventus V12 Evo2',
    cost: 175, quantityAvailable: 3, eta: 'Today', xlLoad: true, speedRating: 'Y' },
  { supplier: 'ATD', size: '245/40R18', brand: 'Michelin', model: 'Pilot Sport 4S',
    cost: 269, quantityAvailable: 1, eta: 'Tomorrow', xlLoad: true, speedRating: 'Y',
    notes: 'Limited stock' },
];

async function searchByTireSize(
  normalizedSize: string,
  _quantity: number
): Promise<SupplierTireResult[]> {
  // Simulate network latency so the orchestrator's parallelism and
  // soft-error handling work like prod will.
  await new Promise((r) => setTimeout(r, 60));
  return ATD_CATALOG.filter((sku) => sku.size === normalizedSize);
}

export const atdConnector: SupplierConnector = {
  name: 'ATD',
  searchByTireSize,
};
