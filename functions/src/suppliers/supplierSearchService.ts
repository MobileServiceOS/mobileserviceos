import {
  SearchResponse, SupplierConnector, SupplierFilter, SupplierTireResult,
} from './supplierTypes';
import { classifyTiers } from './tierClassifier';
import { atdConnector } from './atdConnector';
import { advanceTireConnector } from './advanceTireConnector';
import { usAutoForceConnector } from './usAutoForceConnector';

// Master list of registered connectors. To add a new supplier, append
// it here and create its connector module — no other code changes.
const ALL_CONNECTORS: SupplierConnector[] = [
  atdConnector,
  advanceTireConnector,
  usAutoForceConnector,
];

interface SearchOptions {
  normalizedSize: string;
  quantity: number;
  supplierFilter: SupplierFilter;
}

// Orchestrator: fan-out to selected connectors via Promise.allSettled,
// merge their results, sort by cost ascending, classify tiers, return
// sanitized response. Per-supplier failures degrade to a warning string
// — the search never aborts because one supplier is down.
export async function searchSuppliers(opts: SearchOptions): Promise<SearchResponse> {
  const selected = opts.supplierFilter === 'all'
    ? ALL_CONNECTORS
    : ALL_CONNECTORS.filter((c) => c.name === opts.supplierFilter);

  const settled = await Promise.allSettled(
    selected.map((c) => c.searchByTireSize(opts.normalizedSize, opts.quantity))
  );

  const allResults: SupplierTireResult[] = [];
  const warnings: string[] = [];

  settled.forEach((outcome, i) => {
    const connector = selected[i];
    if (outcome.status === 'fulfilled') {
      // Defensive: connector should never leak internal shape, but if
      // it does, only the SupplierTireResult fields make it out — the
      // type system enforces the contract at the boundary.
      for (const r of outcome.value) {
        allResults.push({
          supplier: connector.name,
          brand: r.brand,
          model: r.model,
          size: r.size,
          cost: r.cost,
          quantityAvailable: r.quantityAvailable,
          eta: r.eta,
          runFlat: r.runFlat,
          xlLoad: r.xlLoad,
          speedRating: r.speedRating,
          loadIndex: r.loadIndex,
          notes: r.notes,
        });
      }
    } else {
      warnings.push(`${connector.name} unavailable`);
    }
  });

  allResults.sort((a, b) => a.cost - b.cost);
  const tiers = classifyTiers(allResults);

  return {
    normalizedSize: opts.normalizedSize,
    tiers,
    allResults,
    warnings,
  };
}
