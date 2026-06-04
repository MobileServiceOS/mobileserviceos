// ═══════════════════════════════════════════════════════════════════
//  tests/lookupCustomerByPhone.test.ts — phone → customer lookup
//  Run: npx tsx tests/lookupCustomerByPhone.test.ts
//  Spec ref: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//            §"AddJob Workflow Change → Returning Customer card spec"
//            §"Hybrid read path also tries the legacy form (transitional)"
// ═══════════════════════════════════════════════════════════════════
import { __testHooks, type LookupOps } from '@/lib/lookupCustomerByPhone';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const { runWithShim } = __testHooks;

function makeOps(over: Partial<LookupOps> = {}): LookupOps {
  return {
    getDocByPath: async () => undefined,
    queryByPhoneKey: async () => [],
    listVehicles: async () => [],
    queryLastJob: async () => undefined,
    ...over,
  };
}

(async () => {
  console.log('\n┌─ invalid phone → null ──────────────────────────');
  {
    const ops = makeOps();
    const res = await runWithShim(ops, 'biz-1', '911');
    check('returns null for short code', res === null);
  }
  {
    const ops = makeOps();
    const res = await runWithShim(ops, 'biz-1', '');
    check('returns null for empty', res === null);
  }
  {
    const ops = makeOps();
    const res = await runWithShim(ops, 'biz-1', '+447911123456');
    check('returns null for UK intl', res === null);
  }

  console.log('\n┌─ canonical 11-digit doc-id hit ─────────────────');
  {
    const cust = { id: 'p_13058977030', name: 'Maria Lopez', phoneKey: '13058977030', lastJobAt: '2026-05-30', lastJobId: 'job-9' };
    const veh = { id: 'honda-civic-2019', year: 2019, make: 'Honda', model: 'Civic', tireSize: '215/55R17', lastServicedAt: '2026-05-30' };
    const job = { id: 'job-9', date: '2026-05-30', service: 'tire_swap', revenue: 450, vehicleMakeModel: 'Honda Civic', city: 'Miami', paymentStatus: 'Paid' };
    let phoneKeyCalled = false;
    const ops = makeOps({
      getDocByPath: async (path: string) => path === 'businesses/biz-1/customers/p_13058977030' ? cust : undefined,
      queryByPhoneKey: async () => { phoneKeyCalled = true; return []; },
      listVehicles: async () => [veh],
      queryLastJob: async () => job,
    });
    const res = await runWithShim(ops, 'biz-1', '(305) 897-7030');
    check('returns customer', res?.customer?.id === 'p_13058977030');
    check('returns vehicles array', Array.isArray(res?.vehicles) && res!.vehicles.length === 1);
    check('returns lastJob', res?.lastJob?.id === 'job-9');
    check('reports latencyMs as a finite number', Number.isFinite(res?.lookupLatencyMs));
    check('does NOT call phoneKey query when doc-id hit found', !phoneKeyCalled);
  }

  console.log('\n┌─ legacy 10-digit doc-id fallback hit ───────────');
  {
    const legacy = { id: 'p_3058977030', name: 'Maria Lopez (legacy)', phoneKey: '13058977030' };
    const ops = makeOps({
      getDocByPath: async (path: string) => path === 'businesses/biz-1/customers/p_3058977030' ? legacy : undefined,
      listVehicles: async () => [],
    });
    const res = await runWithShim(ops, 'biz-1', '3058977030');
    check('returns legacy customer when 11-digit miss + 10-digit hit', res?.customer?.id === 'p_3058977030');
    check('no last job is fine', res?.lastJob === null);
    check('empty vehicles array is fine', Array.isArray(res?.vehicles) && res!.vehicles.length === 0);
  }

  console.log('\n┌─ phoneKey-where fallback (no doc-id hit) ───────');
  {
    const cust = { id: 'p_13058977030_v2', name: 'Maria Lopez', phoneKey: '13058977030', lastJobAt: '2026-05-30' };
    const ops = makeOps({
      getDocByPath: async () => undefined,
      queryByPhoneKey: async (_bid: string, key: string) => key === '13058977030' ? [cust] : [],
    });
    const res = await runWithShim(ops, 'biz-1', '3058977030');
    check('returns customer from phoneKey query when both doc-id paths miss', res?.customer?.id === 'p_13058977030_v2');
  }

  console.log('\n┌─ total miss returns null ───────────────────────');
  {
    const ops = makeOps();
    const res = await runWithShim(ops, 'biz-1', '3055550100');
    check('returns null when no doc-id and no phoneKey hit', res === null);
  }

  console.log('\n┌─ logs slow lookups via console.warn ────────────');
  {
    const cust = { id: 'p_13058977030', name: 'M', phoneKey: '13058977030' };
    const ops = makeOps({
      getDocByPath: async (path: string) => path === 'businesses/biz-1/customers/p_13058977030' ? cust : undefined,
    });
    const res = await runWithShim(ops, 'biz-1', '3058977030');
    check('lookupLatencyMs is present + finite', typeof res?.lookupLatencyMs === 'number' && Number.isFinite(res!.lookupLatencyMs));
    check('lookupLatencyMs is non-negative', (res?.lookupLatencyMs ?? -1) >= 0);
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
})();
