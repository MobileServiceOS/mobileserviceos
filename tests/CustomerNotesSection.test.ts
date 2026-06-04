// tests/CustomerNotesSection.test.ts
import { __pureHooks, QUICK_NOTE_FIELDS } from '@/components/customers/CustomerNotesSection';

let passed = 0; let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}
function eq<T>(a: T, b: T): boolean { return JSON.stringify(a) === JSON.stringify(b); }

const { buildPatch, isDirty, fieldList } = __pureHooks;

console.log('\n┌─ QUICK_NOTE_FIELDS ──────────────────────────────');
check('8 fields exposed', QUICK_NOTE_FIELDS.length === 8);
check('field keys match spec', eq(QUICK_NOTE_FIELDS.map(f => f.key).sort(), [
  'apartmentNumber','gateCode','generalNotes','parkingInstructions',
  'preferredContactMethod','preferredPaymentMethod','tpmsNotes','wheelLockKeyLocation',
]));

console.log('\n┌─ buildPatch ──────────────────────────────────────');
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const original = { id: 'p_1', name: 'X', gateCode: '1234' } as any;
  const patch = buildPatch({ original, draft: { gateCode: '1234' }, editorUid: 'uid-1' });
  check('no changes → no field patch', eq(Object.keys(patch).filter(k => !['updatedAt','lastEditedAt','lastEditedByUid'].includes(k)), []));
}
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const original = { id: 'p_1', name: 'X', gateCode: '1234' } as any;
  const patch = buildPatch({ original, draft: { gateCode: '5678' }, editorUid: 'uid-1' });
  check('patches gateCode', patch.gateCode === '5678');
  check('writes lastEditedByUid', patch.lastEditedByUid === 'uid-1');
  check('writes updatedAt ISO', typeof patch.updatedAt === 'string' && (patch.updatedAt as string).includes('T'));
}
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const original = { id: 'p_1', name: 'X', gateCode: '1234' } as any;
  const patch = buildPatch({ original, draft: { gateCode: '' }, editorUid: 'uid-1' });
  check('blank → empty string write', patch.gateCode === '');
}

console.log('\n┌─ isDirty ────────────────────────────────────────');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
check('no change → clean', isDirty({ original: { gateCode: 'X' } as any, draft: { gateCode: 'X' } }) === false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
check('change → dirty', isDirty({ original: { gateCode: 'X' } as any, draft: { gateCode: 'Y' } }) === true);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
check('original blank, draft set → dirty', isDirty({ original: {} as any, draft: { gateCode: 'Y' } }) === true);

console.log('\n┌─ fieldList ──────────────────────────────────────');
{
  const list = fieldList({ canEdit: false, values: { gateCode: '1234' } });
  check('renders all 8 fields', list.length === 8);
  check('readonly when canEdit=false', list.every(f => f.editable === false));
}
{
  const list = fieldList({ canEdit: true, values: { gateCode: '1234' } });
  check('editable when canEdit=true', list.every(f => f.editable === true));
}

console.log('\n══════════════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
