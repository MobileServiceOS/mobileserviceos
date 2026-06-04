// src/components/customers/CustomerNotesSection.tsx
// ═══════════════════════════════════════════════════════════════════
//  Quick Notes — 8 structured fields, inline editable (owner/admin).
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"Quick Notes" (Customer Profile Sections)
//
//  Edit gate: canEdit. Write path: setDoc(customerRef, patch, { merge: true })
//  via SP1 firestore.rules meta-only allowlist.
// ═══════════════════════════════════════════════════════════════════

import { memo, useCallback, useMemo, useState, type CSSProperties } from 'react';
import { doc, setDoc, type Firestore } from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import type { Customer } from '@/lib/customerEntity';

export interface QuickNoteFieldDef {
  key:
    | 'gateCode' | 'apartmentNumber' | 'wheelLockKeyLocation' | 'tpmsNotes'
    | 'preferredPaymentMethod' | 'parkingInstructions' | 'preferredContactMethod' | 'generalNotes';
  label: string;
  icon: string;
  placeholder: string;
  multiline?: boolean;
}

export const QUICK_NOTE_FIELDS: QuickNoteFieldDef[] = [
  { key: 'gateCode',                label: 'Gate Code',          icon: '🔢', placeholder: '4-6 digits' },
  { key: 'apartmentNumber',         label: 'Apt / Unit',         icon: '🏢', placeholder: 'Apt #' },
  { key: 'wheelLockKeyLocation',    label: 'Wheel Lock Key',     icon: '🔑', placeholder: 'e.g. glove box' },
  { key: 'tpmsNotes',               label: 'TPMS Notes',         icon: '📡', placeholder: 'sensor type / notes', multiline: true },
  { key: 'preferredPaymentMethod',  label: 'Preferred Payment',  icon: '💳', placeholder: 'cash / card / Zelle' },
  { key: 'parkingInstructions',     label: 'Parking',            icon: '🅿️', placeholder: 'where to park' },
  { key: 'preferredContactMethod',  label: 'Contact Preference', icon: '📞', placeholder: 'phone / sms / email' },
  { key: 'generalNotes',            label: 'General Notes',      icon: 'ℹ️', placeholder: 'anything else', multiline: true },
];

type QuickNoteDraft = Partial<Record<QuickNoteFieldDef['key'], string>>;

function _buildPatch(args: {
  original: Customer;
  draft: QuickNoteDraft;
  editorUid: string;
}): Record<string, unknown> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    updatedAt: now,
    lastEditedAt: now,
    lastEditedByUid: args.editorUid,
  };
  for (const f of QUICK_NOTE_FIELDS) {
    const orig = (args.original as unknown as Record<string, unknown>)[f.key] ?? '';
    const next = args.draft[f.key];
    if (next === undefined) continue;
    if (String(orig) !== String(next)) patch[f.key] = next;
  }
  return patch;
}

function _isDirty(args: { original: Customer; draft: QuickNoteDraft }): boolean {
  for (const f of QUICK_NOTE_FIELDS) {
    const orig = String((args.original as unknown as Record<string, unknown>)[f.key] ?? '');
    const next = args.draft[f.key];
    if (next === undefined) continue;
    if (orig !== String(next)) return true;
  }
  return false;
}

function _fieldList(args: { canEdit: boolean; values: Partial<Customer> }) {
  return QUICK_NOTE_FIELDS.map(f => ({
    ...f,
    value: String((args.values as unknown as Record<string, unknown>)[f.key] ?? ''),
    editable: args.canEdit,
  }));
}

interface Props {
  businessId: string;
  customer: Customer;
  canEdit: boolean;
  editorUid: string;
}

function CustomerNotesSectionImpl({ businessId, customer, canEdit, editorUid }: Props) {
  const [draft, setDraft] = useState<QuickNoteDraft>({});
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const dirty = useMemo(() => _isDirty({ original: customer, draft }), [customer, draft]);
  // Cast: draft values are free-text strings; preferredContactMethod's
  // strict union is enforced at save-time via Firestore-rules allowlist,
  // not at the input layer (operator may type "phone " with trailing
  // whitespace, etc.; rules accept all 8 fields verbatim).
  const fields = useMemo(
    () => _fieldList({ canEdit, values: { ...customer, ...draft } as Partial<Customer> }),
    [customer, draft, canEdit],
  );

  const onSave = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const patch = _buildPatch({ original: customer, draft, editorUid });
      const ref = doc(_db as Firestore, 'businesses', businessId, 'customers', customer.id);
      await setDoc(ref, patch, { merge: true });
      setDraft({});
      setEditing(false);
    } catch (err) {
      console.warn('[CustomerNotesSection] save failed', err);
    } finally {
      setSaving(false);
    }
  }, [businessId, customer, draft, dirty, editorUid, saving]);

  const onCancel = useCallback(() => { setDraft({}); setEditing(false); }, []);

  const setField = useCallback((key: QuickNoteFieldDef['key'], v: string) => {
    setDraft(d => ({ ...d, [key]: v }));
  }, []);

  return (
    <section className="form-group card-anim" aria-label="Quick Notes">
      <div className="form-group-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Quick Notes</span>
        {canEdit && !editing && (
          <button type="button" className="btn xs secondary" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {fields.map(f => (
          <div key={f.key} style={rowStyle}>
            <span style={{ fontSize: 16, lineHeight: '20px' }}>{f.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 2 }}>{f.label}</div>
              {editing && canEdit ? (
                f.multiline ? (
                  <textarea
                    value={draft[f.key] ?? f.value}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    rows={2}
                    style={inputStyle}
                  />
                ) : (
                  <input
                    type="text"
                    value={draft[f.key] ?? f.value}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    style={inputStyle}
                  />
                )
              ) : (
                <div style={{ fontSize: 13, color: f.value ? 'var(--t1)' : 'var(--t3)' }}>
                  {f.value || <em>—</em>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {editing && canEdit && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn sm primary" onClick={onSave} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save Notes'}
          </button>
          <button type="button" className="btn sm secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 8,
  padding: '6px 0', borderBottom: '1px solid var(--border, #2a2a2a)',
};
const inputStyle: CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 13,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1, #fff)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
};

export const CustomerNotesSection = memo(CustomerNotesSectionImpl);

export const __pureHooks = {
  buildPatch: _buildPatch,
  isDirty: _isDirty,
  fieldList: _fieldList,
};
