// src/services/businessService.js
import {
  doc, setDoc, getDoc, updateDoc, collection,
  serverTimestamp, addDoc, getDocs, query, orderBy,
  onSnapshot, deleteDoc, where, limit,
} from 'firebase/firestore';
import { db } from './firebase.js';
import { MODEL_CONFIGS } from '../features/businessModel/modelConfigs.js';

// ─── Paths ─────────────────────────────────────────────────────────────────
export const bizRef       = (bId)       => doc(db, 'businesses', bId);
export const settingRef   = (bId, name) => doc(db, 'businesses', bId, 'settings', name);
export const colRef       = (bId, col)  => collection(db, 'businesses', bId, col);
export const itemRef      = (bId, col, id) => doc(db, 'businesses', bId, col, id);

// ─── Business creation ─────────────────────────────────────────────────────
export async function createBusiness({ businessId, ownerId, name, modelType = 'tire_service' }) {
  const now = serverTimestamp();

  // Root business doc
  await setDoc(bizRef(businessId), {
    businessId, ownerId, name, modelType,
    onboardingCompleted: false,
    onboardingStep: 1,
    createdAt: now, updatedAt: now,
  });

  // User doc
  await setDoc(doc(db, 'users', ownerId), {
    userId: ownerId, businessId, role: 'owner', createdAt: now,
  });

  // Business user membership
  await setDoc(doc(db, 'businesses', businessId, 'users', ownerId), {
    userId: ownerId, role: 'owner', createdAt: now,
  });

  // Default settings docs
  await setDoc(settingRef(businessId, 'branding'), {
    logoUrl: '', logoBase64: '', brandColor: '#ea580c',
    businessName: name, tagline: '',
  });

  await setDoc(settingRef(businessId, 'businessProfile'), {
    phone: '', email: '', website: '', address: '', zelleInfo: '', venmoHandle: '', timezone: 'America/New_York',
  });

  await setDoc(settingRef(businessId, 'businessModel'), {
    modelType, weekStartDay: 5, paydayDay: 5,
    monthlyOverhead: 0, customLabel: '',
  });

  await setDoc(settingRef(businessId, 'travelPricing'), {
    costPerMile: 0.65, chargePerMile: 1.0,
    freeRadiusMiles: 5, roundTrip: false,
    bands: [
      { maxMiles: 10, surcharge: 0 },
      { maxMiles: 20, surcharge: 10 },
      { maxMiles: 30, surcharge: 20 },
      { maxMiles: 999, surcharge: 35 },
    ],
  });

  await setDoc(settingRef(businessId, 'payoutConfig'), {
    weekStartDay: 5, paydayDay: 5,
    overheadMode: 'weekly_fixed', weeklyOverhead: 0, monthlyOverhead: 0,
    team: [
      { id: 'tm_1', name: 'Owner 1', role: 'owner',   payType: 'profit_percentage', value: 100, active: true },
    ],
  });

  await setDoc(settingRef(businessId, 'subscription'), {
    status: 'none', stripeCustomerId: '', stripeSubscriptionId: '',
    trialEndsAt: null, currentPeriodEnd: null,
    cancelAtPeriodEnd: false, readOnly: false, updatedAt: now,
  });

  // Load model defaults into services and materials
  const cfg = MODEL_CONFIGS[modelType] || MODEL_CONFIGS.tire_service;
  for (const svc of cfg.defaultServices) {
    await addDoc(colRef(businessId, 'services'), {
      ...svc, active: true, modelType, createdAt: now,
    });
  }
  for (const mat of cfg.defaultMaterials) {
    await addDoc(colRef(businessId, 'materials'), {
      name: mat, unit: 'ea', defaultCost: 0, active: true, createdAt: now,
    });
  }
}

// ─── Business reads ────────────────────────────────────────────────────────
export async function getBusiness(businessId) {
  const snap = await getDoc(bizRef(businessId));
  return snap.exists() ? snap.data() : null;
}

export async function getSettings(businessId) {
  const names = ['branding', 'businessProfile', 'businessModel', 'travelPricing', 'payoutConfig', 'subscription'];
  const results = await Promise.all(names.map(n => getDoc(settingRef(businessId, n))));
  const out = {};
  names.forEach((n, i) => { out[n] = results[i].exists() ? results[i].data() : {}; });
  return out;
}

export async function updateSetting(businessId, name, data) {
  await setDoc(settingRef(businessId, name), data, { merge: true });
}

export async function updateBusiness(businessId, data) {
  await updateDoc(bizRef(businessId), { ...data, updatedAt: serverTimestamp() });
}

// ─── User → businessId lookup ──────────────────────────────────────────────
export async function getUserBusiness(userId) {
  const snap = await getDoc(doc(db, 'users', userId));
  if (!snap.exists()) return null;
  return snap.data().businessId;
}

// ─── Services CRUD ─────────────────────────────────────────────────────────
export function listenServices(businessId, cb) {
  return onSnapshot(query(colRef(businessId, 'services'), orderBy('name')), snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}
export async function addService(businessId, data) {
  await addDoc(colRef(businessId, 'services'), { ...data, createdAt: serverTimestamp() });
}
export async function updateService(businessId, id, data) {
  await setDoc(itemRef(businessId, 'services', id), data, { merge: true });
}
export async function deleteService(businessId, id) {
  await deleteDoc(itemRef(businessId, 'services', id));
}

// ─── Areas CRUD ────────────────────────────────────────────────────────────
export function listenAreas(businessId, cb) {
  return onSnapshot(query(colRef(businessId, 'areas'), orderBy('name')), snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}
export async function addArea(businessId, data) {
  await addDoc(colRef(businessId, 'areas'), { ...data, createdAt: serverTimestamp() });
}
export async function deleteArea(businessId, id) {
  await deleteDoc(itemRef(businessId, 'areas', id));
}

// ─── Jobs CRUD ─────────────────────────────────────────────────────────────
export function listenJobs(businessId, cb, limitN = 100) {
  const q = query(colRef(businessId, 'jobs'), orderBy('date', 'desc'), limit(limitN));
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}
export async function addJob(businessId, data) {
  return await addDoc(colRef(businessId, 'jobs'), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
}
export async function updateJob(businessId, id, data) {
  await setDoc(itemRef(businessId, 'jobs', id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}
export async function deleteJob(businessId, id) {
  await deleteDoc(itemRef(businessId, 'jobs', id));
}
export async function getJob(businessId, id) {
  const snap = await getDoc(itemRef(businessId, 'jobs', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ─── Expenses CRUD ─────────────────────────────────────────────────────────
export function listenExpenses(businessId, cb) {
  const q = query(colRef(businessId, 'expenses'), orderBy('date', 'desc'));
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}
export async function addExpense(businessId, data) {
  return await addDoc(colRef(businessId, 'expenses'), { ...data, createdAt: serverTimestamp() });
}
export async function deleteExpense(businessId, id) {
  await deleteDoc(itemRef(businessId, 'expenses', id));
}

// ─── Payout snapshots ──────────────────────────────────────────────────────
export async function savePayoutSnapshot(businessId, weekKey, data) {
  await setDoc(itemRef(businessId, 'payoutSnapshots', weekKey), { ...data, savedAt: serverTimestamp() });
}
export async function getPayoutSnapshot(businessId, weekKey) {
  const snap = await getDoc(itemRef(businessId, 'payoutSnapshots', weekKey));
  return snap.exists() ? snap.data() : null;
}
export function listenPayoutSnapshots(businessId, cb) {
  const q = query(colRef(businessId, 'payoutSnapshots'), orderBy('weekKey', 'desc'), limit(20));
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ─── Subscription gate ─────────────────────────────────────────────────────
export function canWrite(subscription = {}) {
  const { status, trialEndsAt, readOnly } = subscription;
  if (readOnly) return false;
  if (status === 'active') return true;
  if (status === 'trial') {
    if (!trialEndsAt) return true;
    const end = trialEndsAt?.toDate ? trialEndsAt.toDate() : new Date(trialEndsAt);
    return end > new Date();
  }
  return false;
}
