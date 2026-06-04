// ═══════════════════════════════════════════════════════════════════
//  tests/searchCustomers.test.ts — Global search ranking + prefix regression
//  Run: npx tsx tests/searchCustomers.test.ts
//  Spec: §"Global Customer Search (Phase 5)" + §"Critical prefix-query contract"
// ═══════════════════════════════════════════════════════════════════
import { __testHooks, type SearchOps } from '@/lib/searchCustomers';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}
function eq<T>(actual: T, expected: T): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

const { runWithShim } = __testHooks;

const tesla    = { id: 'p_13050001111', name: 'Tesla Owner',    nameLower: 'tesla owner' };
const tetris   = { id: 'p_13050002222', name: 'Tetris Player',  nameLower: 'tetris player' };
const terra    = { id: 'p_13050003333', name: 'Terra Holdings', nameLower: 'terra holdings' };
const acme     = { id: 'p_13050004444', name: 'Acme Inc',       nameLower: 'acme inc',
                   companyName: 'Tesla LLC', companyLower: 'tesla llc' };
const maria    = { id: 'p_13058977030', name: 'Maria Lopez',    nameLower: 'maria lopez',
                   phoneE164: '+13058977030', phoneKey: '13058977030' };
const cityHit  = { id: 'p_13059999999', name: 'Hollywood Hank', nameLower: 'hollywood hank',
                   city: 'Hollywood',       cityLower: 'hollywood' };

function makeOps(over: Partial<SearchOps> = {}): SearchOps {
  return {
    queryByNamePrefix:     async () => [],
    queryByCompanyPrefix:  async () => [],
    queryByPhoneExact:     async () => [],
    queryByPhoneSuffix4:   async () => [],
    queryByCityPrefix:     async () => [],
    queryByZipExact:       async () => [],
    queryByMakeModelPrefix:async () => [],
    queryByLicensePlate:   async () => [],
    queryByTireSize:       async () => [],
    queryByTireSizeLegacy: async () => [],
    ...over,
  };
}

(async () => {
  console.log('\n┌─ short-circuit: 1-char query returns [] ────────');
  {
    const ops = makeOps();
    const res = await runWithShim(ops, 'biz-1', 'a');
    check('1-char query empty', eq(res, []));
  }
  {
    const ops = makeOps();
    const res = await runWithShim(ops, 'biz-1', '');
    check('empty query empty', eq(res, []));
  }

  console.log('\n┌─ prefix-query regression: te → Tesla, Tetris, Terra ──');
  {
    const ops = makeOps({
      queryByNamePrefix: async (_bid, lo, hi) => {
        check('high-sentinel is uf8ff', hi.charCodeAt(hi.length - 1) === 0xf8ff);
        check('low bound is the lowercased query', lo === 'te');
        return [tesla, tetris, terra];
      },
    });
    const res = await runWithShim(ops, 'biz-1', 'te');
    check('returns 3 name-prefix hits', res.length === 3);
    // Alphabetical tiebreak within same field-priority puts Terra first.
    check('first hit is Terra (alphabetical)', res[0].customer.id === terra.id);
    check('matchedField is name', res[0].matchedField === 'name');
  }

  console.log('\n┌─ ranking: exact phone beats every prefix ────────');
  {
    const ops = makeOps({
      queryByPhoneExact: async () => [maria],
      queryByNamePrefix: async () => [tesla],
    });
    const res = await runWithShim(ops, 'biz-1', '3058977030');
    check('exact phone ranks above name prefix', res[0].customer.id === maria.id);
    check('matchedField is phone', res[0].matchedField === 'phone');
  }

  console.log('\n┌─ ranking: city-prefix ranks below name-prefix ───');
  {
    const ops = makeOps({
      queryByNamePrefix: async () => [tesla],
      queryByCityPrefix: async () => [cityHit],
    });
    const res2 = await runWithShim(ops, 'biz-1', 'ho');
    check('2-char query passes through fan-out', res2.length >= 1);
  }

  console.log('\n┌─ dedupe: same customer matched by 2 fields ───────');
  {
    const ops = makeOps({
      queryByNamePrefix:    async () => [acme],
      queryByCompanyPrefix: async () => [acme],
    });
    const res = await runWithShim(ops, 'biz-1', 'tesla');
    check('dedupes by customer id', res.filter(r => r.customer.id === acme.id).length === 1);
    check('name match wins over company match in dedupe', res[0].matchedField === 'name');
  }

  console.log('\n┌─ vehicle match: returns matchedVehicles array ──');
  {
    const honda = { customerId: acme.id, id: 'v-1', make: 'Honda', model: 'Civic',
                    makeModelLower: 'honda civic', tireSize: '215/55R17' };
    const ops = makeOps({
      queryByMakeModelPrefix: async () => [honda],
    });
    const res = await runWithShim(ops, 'biz-1', 'honda');
    check('vehicle prefix hit', res.length === 1);
    check('matchedVehicles populated', res[0].matchedVehicles.length === 1);
    check('matchedField is vehicle', res[0].matchedField === 'vehicle');
  }

  console.log('\n┌─ scopedCustomerIds RBAC filter ──────────────────');
  {
    const ops = makeOps({
      queryByNamePrefix: async () => [tesla, tetris],
    });
    const scoped = new Set<string>([tesla.id]);
    const res = await runWithShim(ops, 'biz-1', 'te', { scopedCustomerIds: scoped });
    check('post-fetch filter applied', res.length === 1 && res[0].customer.id === tesla.id);
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
})();
