import { SupplierConnector, SupplierTireResult } from './supplierTypes';

// U.S. AutoForce connector — Phase 1 mock.
//
// Catalog is broad and competitive across tiers — mirrors U.S.
// AutoForce's strong national brand catalog.
//
// Phase 2 (TODO): replace with real U.S. AutoForce portal calls.
//   - Auth: their B2B portal API requires an integration agreement.
//     Talk to your assigned regional rep, NOT the website. Same partner
//     gate as ATD/Advance Tire.
//   - Secrets: USAUTOFORCE_USERNAME, USAUTOFORCE_PASSWORD.
//   - Throw on any upstream error — orchestrator surfaces sanitized
//     "U.S. AutoForce unavailable" warning.

const USAF_CATALOG: SupplierTireResult[] = [
  // 225/45R17
  { supplier: 'U.S. AutoForce', size: '225/45R17', brand: 'Milestar', model: 'MS932 Sport',
    cost: 76, quantityAvailable: 12, eta: 'Today', xlLoad: true, speedRating: 'W' },
  { supplier: 'U.S. AutoForce', size: '225/45R17', brand: 'Sumitomo', model: 'HTR A/S P03',
    cost: 122, quantityAvailable: 6, eta: 'Today', xlLoad: true, speedRating: 'W' },
  { supplier: 'U.S. AutoForce', size: '225/45R17', brand: 'General', model: 'G-MAX AS-07',
    cost: 138, quantityAvailable: 4, eta: 'Today', speedRating: 'W' },
  { supplier: 'U.S. AutoForce', size: '225/45R17', brand: 'Continental', model: 'ProContact RX',
    cost: 178, quantityAvailable: 3, eta: 'Tomorrow', xlLoad: true, speedRating: 'V',
    notes: 'OE replacement' },
  { supplier: 'U.S. AutoForce', size: '225/45R17', brand: 'Michelin', model: 'Pilot Sport All Season 4',
    cost: 196, quantityAvailable: 2, eta: 'Today', xlLoad: true, speedRating: 'Y' },

  // 225/65R17
  { supplier: 'U.S. AutoForce', size: '225/65R17', brand: 'Milestar', model: 'Patagonia AT R',
    cost: 85, quantityAvailable: 10, eta: 'Today', speedRating: 'T' },
  { supplier: 'U.S. AutoForce', size: '225/65R17', brand: 'Cooper', model: 'Discoverer SRX',
    cost: 138, quantityAvailable: 4, eta: 'Today', speedRating: 'H' },
  { supplier: 'U.S. AutoForce', size: '225/65R17', brand: 'General', model: 'Altimax RT45',
    cost: 145, quantityAvailable: 6, eta: 'Today', speedRating: 'H',
    notes: '75k warranty' },
  { supplier: 'U.S. AutoForce', size: '225/65R17', brand: 'Continental', model: 'TrueContact Tour',
    cost: 178, quantityAvailable: 3, eta: 'Today', speedRating: 'H' },
  { supplier: 'U.S. AutoForce', size: '225/65R17', brand: 'Michelin', model: 'CrossClimate2',
    cost: 215, quantityAvailable: 2, eta: 'Tomorrow', speedRating: 'V' },

  // 235/55R18
  { supplier: 'U.S. AutoForce', size: '235/55R18', brand: 'Milestar', model: 'MS932 Sport',
    cost: 98, quantityAvailable: 8, eta: 'Today', xlLoad: true, speedRating: 'V' },
  { supplier: 'U.S. AutoForce', size: '235/55R18', brand: 'Sumitomo', model: 'HTR Enhance LX2',
    cost: 142, quantityAvailable: 4, eta: 'Today', speedRating: 'V' },
  { supplier: 'U.S. AutoForce', size: '235/55R18', brand: 'General', model: 'G-MAX AS-07',
    cost: 158, quantityAvailable: 4, eta: 'Today', speedRating: 'W' },
  { supplier: 'U.S. AutoForce', size: '235/55R18', brand: 'Continental', model: 'CrossContact LX25',
    cost: 192, quantityAvailable: 3, eta: 'Tomorrow', speedRating: 'H' },

  // 245/40R18
  { supplier: 'U.S. AutoForce', size: '245/40R18', brand: 'Milestar', model: 'MS932 Sport',
    cost: 95, quantityAvailable: 10, eta: 'Today', xlLoad: true, speedRating: 'W' },
  { supplier: 'U.S. AutoForce', size: '245/40R18', brand: 'Sumitomo', model: 'HTR Z5',
    cost: 152, quantityAvailable: 4, eta: 'Today', xlLoad: true, speedRating: 'Y' },
  { supplier: 'U.S. AutoForce', size: '245/40R18', brand: 'Toyo', model: 'Proxes Sport A/S',
    cost: 184, quantityAvailable: 3, eta: 'Today', xlLoad: true, speedRating: 'Y' },
  { supplier: 'U.S. AutoForce', size: '245/40R18', brand: 'Continental', model: 'ExtremeContact DWS06+',
    cost: 218, quantityAvailable: 2, eta: 'Tomorrow', xlLoad: true, speedRating: 'Y' },
];

async function searchByTireSize(
  normalizedSize: string,
  _quantity: number
): Promise<SupplierTireResult[]> {
  await new Promise((r) => setTimeout(r, 70));
  return USAF_CATALOG.filter((sku) => sku.size === normalizedSize);
}

export const usAutoForceConnector: SupplierConnector = {
  name: 'U.S. AutoForce',
  searchByTireSize,
};
