import { SupplierConnector, SupplierTireResult } from './supplierTypes';

// Advance Tire connector — Phase 1 mock.
//
// Catalog leans toward a narrower brand mix than ATD's, with slightly
// higher costs in the premium tier (reflects Advance Tire's typical
// pricing posture — strong on national brands, less budget depth).
//
// Phase 2 (TODO): replace with real Advance Tire portal calls.
//   - Auth: partner-only API. No public docs. Same path as ATD — get
//     credentials through your wholesale rep first.
//   - Secrets: ADVANCE_TIRE_USERNAME, ADVANCE_TIRE_PASSWORD.
//   - Throw on any upstream error — orchestrator surfaces sanitized
//     "Advance Tire unavailable" warning.

const ADVANCE_TIRE_CATALOG: SupplierTireResult[] = [
  // 225/45R17
  { supplier: 'Advance Tire', size: '225/45R17', brand: 'Arroyo', model: 'Ultra Sport A/S',
    cost: 79, quantityAvailable: 6, eta: 'Tomorrow', speedRating: 'W' },
  { supplier: 'Advance Tire', size: '225/45R17', brand: 'Falken', model: 'Azenis FK510',
    cost: 152, quantityAvailable: 4, eta: 'Today', xlLoad: true, speedRating: 'Y' },
  { supplier: 'Advance Tire', size: '225/45R17', brand: 'Bridgestone', model: 'Potenza RE980AS+',
    cost: 188, quantityAvailable: 2, eta: 'Today', xlLoad: true, speedRating: 'W' },
  { supplier: 'Advance Tire', size: '225/45R17', brand: 'Michelin', model: 'Pilot Sport All Season 4',
    cost: 205, quantityAvailable: 1, eta: 'Tomorrow', xlLoad: true, speedRating: 'Y' },

  // 225/65R17
  { supplier: 'Advance Tire', size: '225/65R17', brand: 'Crosswind', model: '4x4 HP',
    cost: 82, quantityAvailable: 8, eta: 'Today', speedRating: 'H' },
  { supplier: 'Advance Tire', size: '225/65R17', brand: 'Firestone', model: 'Destination LE3',
    cost: 159, quantityAvailable: 4, eta: 'Tomorrow', speedRating: 'H' },
  { supplier: 'Advance Tire', size: '225/65R17', brand: 'Bridgestone', model: 'Dueler H/L 422 Ecopia',
    cost: 192, quantityAvailable: 2, eta: 'Today', speedRating: 'H',
    notes: 'Low rolling resistance' },

  // 235/55R18
  { supplier: 'Advance Tire', size: '235/55R18', brand: 'Prinx', model: 'HiCity HH2',
    cost: 95, quantityAvailable: 6, eta: 'Today', speedRating: 'V' },
  { supplier: 'Advance Tire', size: '235/55R18', brand: 'Firestone', model: 'Destination LE3',
    cost: 162, quantityAvailable: 4, eta: 'Tomorrow', speedRating: 'V' },
  { supplier: 'Advance Tire', size: '235/55R18', brand: 'Bridgestone', model: 'Dueler H/L Alenza Plus',
    cost: 218, quantityAvailable: 2, eta: 'Today', speedRating: 'H' },

  // 245/40R18
  { supplier: 'Advance Tire', size: '245/40R18', brand: 'Fullway', model: 'HP108',
    cost: 92, quantityAvailable: 8, eta: 'Today', xlLoad: true, speedRating: 'W' },
  { supplier: 'Advance Tire', size: '245/40R18', brand: 'Falken', model: 'Azenis FK510',
    cost: 168, quantityAvailable: 4, eta: 'Today', xlLoad: true, speedRating: 'Y' },
  { supplier: 'Advance Tire', size: '245/40R18', brand: 'Pirelli', model: 'P Zero All Season Plus',
    cost: 242, quantityAvailable: 1, eta: 'Tomorrow', xlLoad: true, speedRating: 'Y' },
];

async function searchByTireSize(
  normalizedSize: string,
  _quantity: number
): Promise<SupplierTireResult[]> {
  await new Promise((r) => setTimeout(r, 80));
  return ADVANCE_TIRE_CATALOG.filter((sku) => sku.size === normalizedSize);
}

export const advanceTireConnector: SupplierConnector = {
  name: 'Advance Tire',
  searchByTireSize,
};
