import * as admin from 'firebase-admin';
import { StoredSessionEnvelope } from './cookieParsers';

// Storage for supplier session envelopes.
//
// Layout: a single Firestore doc holds every supplier's latest session
// under field-keyed entries. Both the read and the write paths go
// through the admin SDK (firebase-admin), so no client SDK can ever
// touch this doc regardless of who's authenticated.
//
//   Doc:     backend/wheelRushSupplierSessions
//   Fields:  usAutoForce: StoredSessionEnvelope (or absent)
//            atd:          StoredSessionEnvelope (Phase 2b)
//            advanceTire:  StoredSessionEnvelope (Phase 2c)
//
// Defense:
//   1. Firestore security rules deny ALL client access to backend/**
//      (see firestore.rules — added in the same commit as this file)
//   2. Admin SDK bypasses rules. Only Cloud Functions code can read.
//   3. The doc lives at top level under `backend/`, NOT inside
//      `businesses/{bid}/...`, so a future scoping mistake on the
//      tenant rules can't accidentally expose it.
//
// Why this instead of Secret Manager: Secret Manager is the textbook
// answer for "store credentials", but writing new versions requires
// a `secretmanager.secretVersionAdder` IAM grant per secret that
// Firebase CLI doesn't auto-apply. Firestore + admin SDK needs zero
// IAM setup — the function's service account has admin-tier access
// to its own project's Firestore by default. We retain the same
// confidentiality property (no client read path) via rules.

const DOC_PATH = 'backend/wheelRushSupplierSessions';

export const SUPPLIER_FIELD_KEYS = {
  'U.S. AutoForce': 'usAutoForce',
} as const;

export type SupplierFieldKey = (typeof SUPPLIER_FIELD_KEYS)[keyof typeof SUPPLIER_FIELD_KEYS];

export interface SessionReadResult {
  envelope: StoredSessionEnvelope;
}

// Read the latest session for a supplier. Returns null when the
// supplier has never been connected (field absent or doc missing).
// Throws only on Firestore infrastructure errors.
export async function readLatestSession(
  fieldKey: SupplierFieldKey
): Promise<SessionReadResult | null> {
  const snap = await admin.firestore().doc(DOC_PATH).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data) return null;
  const envelope = data[fieldKey] as StoredSessionEnvelope | undefined;
  if (!envelope) return null;
  if (envelope.version !== 1) {
    throw new Error(`Unsupported session envelope version: ${envelope.version}`);
  }
  if (!Array.isArray(envelope.cookies)) {
    throw new Error('Stored session is malformed');
  }
  return { envelope };
}

// Write a new session for a supplier. Atomic at the field level via
// merge:true — concurrent writes to different suppliers don't clobber
// each other. Creates the doc on first use.
export async function writeNewSession(
  fieldKey: SupplierFieldKey,
  envelope: StoredSessionEnvelope
): Promise<{ savedAt: string }> {
  await admin.firestore().doc(DOC_PATH).set(
    { [fieldKey]: envelope },
    { merge: true }
  );
  return { savedAt: envelope.savedAt };
}
