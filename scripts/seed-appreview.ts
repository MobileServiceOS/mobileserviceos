// scripts/seed-appreview.ts
// ═══════════════════════════════════════════════════════════════════
//  Apple App Review DEMO ACCOUNT seeder — targets LIVE Firebase.
//
//  Creates (or reuses) a dedicated reviewer account and seeds it with
//  realistic but 100% FICTIONAL data so App Review sees a populated,
//  working app — never real Wheel Rush data.
//
//  ISOLATION (verified against firestore.rules):
//    The account's businessId === its own uid. `businesses/{businessId}`
//    is readable/writable only by a member, and the rules treat
//    `request.auth.uid == businessId` as the legacy self-owned tenant.
//    So this account is a fully isolated tenant: it can NEVER read or
//    write any other business (Wheel Rush included), and no real data
//    can be reached or mutated through it.
//
//  SECRET HANDLING: the password is read from APPREVIEW_PASSWORD (env)
//  so it never lands in git. Email defaults to appreview@mobileserviceos.app
//  (override with APPREVIEW_EMAIL).
//
//  Run:
//    APPREVIEW_PASSWORD='your-password' npm run seed:appreview
//
//  Idempotent: set-with-merge + sign-in fallback; safe to re-run.
// ═══════════════════════════════════════════════════════════════════

import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';

// ── Production guard ────────────────────────────────────────────────
// This script writes to PRODUCTION. Refuse to run if emulator env vars
// are set (the opposite of seed-emulator.ts) so it can't silently no-op
// against a local emulator.
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('[appreview] Refusing to run: emulator env vars are set. This script targets PRODUCTION.');
  process.exit(1);
}

const EMAIL = (process.env.APPREVIEW_EMAIL || 'appreview@mobileserviceos.app').trim();
const PASSWORD = (process.env.APPREVIEW_PASSWORD || '').trim();
if (!PASSWORD) {
  console.error('[appreview] APPREVIEW_PASSWORD env var is required (so the password never lands in git).');
  process.exit(1);
}

// Live public web config (same values the shipped app uses; safe to embed).
const FB_CFG = {
  apiKey: 'AIzaSyDpe9pVejH1EFZmQYv04sgtZBoLxqM6lW0',
  authDomain: 'mobile-service-os.firebaseapp.com',
  projectId: 'mobile-service-os',
  storageBucket: 'mobile-service-os.firebasestorage.app',
  messagingSenderId: '77527561910',
  appId: '1:77527561910:web:4a0c65c0203d403f4f5817',
};

// ── Fictional demo data ─────────────────────────────────────────────
interface DemoJob {
  firstName: string; lastName: string; phone: string;
  vehicleYear: number; vehicleMake: string; vehicleModel: string; vehicleType: string;
  tireSize: string; city: string; state: string; zip: string;
  service: string; revenue: number; qty: number; source: string;
  status: 'Completed' | 'Pending' | 'Scheduled';
  paymentStatus: 'Paid' | 'Pending Payment'; payMethod?: string;
  daysAgo: number; // negative => in the future (scheduled)
  note: string;
}

const DEMO_JOBS: DemoJob[] = [
  { firstName: 'Marcus', lastName: 'Bell', phone: '+13055550148', vehicleYear: 2021, vehicleMake: 'Toyota', vehicleModel: 'Camry', vehicleType: 'Sedan', tireSize: '215/55R17', city: 'Miami', state: 'FL', zip: '33133', service: 'Tire Replacement', revenue: 480, qty: 4, source: 'Google', status: 'Completed', paymentStatus: 'Paid', payMethod: 'Card', daysAgo: 28, note: 'Gate code 1180 · driveway on the left' },
  { firstName: 'Diane', lastName: 'Foster', phone: '+13055550172', vehicleYear: 2022, vehicleMake: 'Honda', vehicleModel: 'CR-V', vehicleType: 'SUV / Truck', tireSize: '235/65R18', city: 'Hialeah', state: 'FL', zip: '33012', service: 'Tire Installation', revenue: 720, qty: 4, source: 'Google', status: 'Completed', paymentStatus: 'Paid', payMethod: 'Zelle', daysAgo: 14, note: 'Set of 4 · customer-supplied wheels' },
  { firstName: 'Victor', lastName: 'Ramos', phone: '+13055550195', vehicleYear: 2020, vehicleMake: 'Ford', vehicleModel: 'F-150', vehicleType: 'SUV / Truck', tireSize: '275/65R18', city: 'Aventura', state: 'FL', zip: '33180', service: 'Spare Tire Installation', revenue: 95, qty: 1, source: 'Referral', status: 'Completed', paymentStatus: 'Paid', payMethod: 'Cash', daysAgo: 5, note: 'Roadside · I-95 NB near exit 16' },
  { firstName: 'Sandra', lastName: 'Klein', phone: '+13055550210', vehicleYear: 2019, vehicleMake: 'Nissan', vehicleModel: 'Altima', vehicleType: 'Sedan', tireSize: '215/60R16', city: 'Hollywood', state: 'FL', zip: '33020', service: 'Flat Tire Repair', revenue: 45, qty: 1, source: 'Repeat', status: 'Completed', paymentStatus: 'Pending Payment', daysAgo: 2, note: 'Nail in right rear · plug + patch' },
  { firstName: 'Terrence', lastName: 'Wood', phone: '+13055550234', vehicleYear: 2021, vehicleMake: 'Chevrolet', vehicleModel: 'Silverado', vehicleType: 'SUV / Truck', tireSize: '275/55R20', city: 'Miami Gardens', state: 'FL', zip: '33056', service: 'Tire Replacement', revenue: 1180, qty: 4, source: 'Google', status: 'Completed', paymentStatus: 'Paid', payMethod: 'Card', daysAgo: 9, note: 'Fleet truck #7' },
  { firstName: 'Olivia', lastName: 'Park', phone: '+13055550258', vehicleYear: 2023, vehicleMake: 'Tesla', vehicleModel: 'Model Y', vehicleType: 'SUV / Truck', tireSize: '255/45R19', city: 'Doral', state: 'FL', zip: '33122', service: 'Tire Installation', revenue: 980, qty: 4, source: 'Website', status: 'Completed', paymentStatus: 'Paid', payMethod: 'Zelle', daysAgo: 20, note: 'TPMS relearn after install' },
  { firstName: 'Henry', lastName: 'Stone', phone: '+13055550279', vehicleYear: 2022, vehicleMake: 'BMW', vehicleModel: 'X5', vehicleType: 'SUV / Truck', tireSize: '275/40R20', city: 'Miramar', state: 'FL', zip: '33027', service: 'Tire Replacement', revenue: 1640, qty: 4, source: 'Google', status: 'Pending', paymentStatus: 'Pending Payment', daysAgo: 1, note: 'Awaiting completion · staggered fitment' },
  { firstName: 'Grace', lastName: 'Lin', phone: '+13055550293', vehicleYear: 2023, vehicleMake: 'Audi', vehicleModel: 'Q5', vehicleType: 'SUV / Truck', tireSize: '235/55R19', city: 'Miami', state: 'FL', zip: '33156', service: 'Tire Replacement', revenue: 920, qty: 4, source: 'Referral', status: 'Scheduled', paymentStatus: 'Pending Payment', daysAgo: -3, note: 'Booked appointment · confirm morning of' },
];

interface DemoInv { size: string; qty: number; cost: number; brand: string; reorderPoint: number; }
const DEMO_INVENTORY: DemoInv[] = [
  { size: '235/65R18', qty: 6, cost: 110, brand: 'Michelin', reorderPoint: 2 },
  { size: '275/65R18', qty: 2, cost: 145, brand: 'Goodyear', reorderPoint: 2 },
  { size: '215/55R17', qty: 8, cost: 85, brand: 'Continental', reorderPoint: 2 },
  { size: '255/45R19', qty: 1, cost: 165, brand: 'Pirelli', reorderPoint: 2 },
  { size: '275/40R20', qty: 0, cost: 190, brand: 'Bridgestone', reorderPoint: 2 },
  { size: '215/60R16', qty: 4, cost: 78, brand: 'Falken', reorderPoint: 2 },
];

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}
function isoDateTimeDaysAhead(days: number): string {
  const d = new Date(Date.now() + days * 86400_000);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}
const phoneKey = (e164: string) => e164.replace(/[^\d]/g, '');
const lower = (s: string) => s.trim().toLowerCase();
const vipTier = (rev: number) => (rev >= 2500 ? 'Platinum' : rev >= 1000 ? 'Gold' : 'Standard');

async function main(): Promise<void> {
  const app = initializeApp(FB_CFG);
  const auth = getAuth(app);
  const db = getFirestore(app);

  // ─── 1. Reviewer auth user ────────────────────────────────────────
  let uid: string;
  try {
    const cred = await createUserWithEmailAndPassword(auth, EMAIL, PASSWORD);
    uid = cred.user.uid;
    console.log(`[appreview] Created auth user ${EMAIL} → uid=${uid}`);
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === 'auth/email-already-in-use') {
      const cred = await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
      uid = cred.user.uid;
      console.log(`[appreview] Reusing existing auth user → uid=${uid}`);
    } else {
      throw err;
    }
  }

  // businessId === uid → isolated, self-owned legacy tenant.
  const BID = uid;

  // ─── 2. settings/main FIRST (stamps ownerUid; carries onboardingComplete) ──
  await setDoc(doc(db, 'businesses', BID, 'settings', 'main'), {
    businessName: 'Sunshine Mobile Tire',
    businessType: 'tire',
    serviceFocus: 'tire_repair',
    ownerUid: uid,
    onboardingComplete: true,
    onboardingCompletedAt: new Date().toISOString(),
    primaryColor: '#f4b400',
    phone: '+13055550100',
    city: 'Miami',
    state: 'FL',
    weeklyGoal: 3000,
    autoSaveCustomersFromJobs: true,
    freeMilesIncluded: 15,
    costPerMile: 0.65,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  // ─── 3. membership + business root + user→business mapping ─────────
  await setDoc(doc(db, 'businesses', BID, 'members', uid), {
    uid, role: 'owner', email: EMAIL, displayName: 'App Review Demo',
    permissions: { canViewFinancials: true, canEditBusinessSettings: true, canCreateJobs: true },
    createdAt: serverTimestamp(),
  }, { merge: true });

  await setDoc(doc(db, 'businesses', BID), {
    id: BID, name: 'Sunshine Mobile Tire', businessType: 'tire',
    ownerUid: uid, createdAt: serverTimestamp(),
  }, { merge: true });

  await setDoc(doc(db, 'users', uid), {
    uid, email: EMAIL, businessId: BID, displayName: 'App Review Demo',
    createdAt: serverTimestamp(),
  }, { merge: true });

  console.log(`[appreview] Tenant ready: businesses/${BID} (onboardingComplete=true)`);

  // ─── 4. Customers + Vehicles + Jobs ───────────────────────────────
  for (const c of DEMO_JOBS) {
    const pKey = phoneKey(c.phone);
    const customerId = `p_${pKey}`;
    const vehicleId = `${c.vehicleYear}-${lower(c.vehicleMake)}-${lower(c.vehicleModel)}`;
    const jobId = `demojob-${customerId}`;
    const scheduled = c.status === 'Scheduled';
    const dateISO = scheduled ? isoDaysAgo(0) : isoDaysAgo(c.daysAgo);
    const fullName = `${c.firstName} ${c.lastName}`;

    await setDoc(doc(db, 'businesses', BID, 'customers', customerId), {
      name: fullName, nameLower: lower(fullName), kind: 'individual',
      phoneE164: c.phone, phoneKey: pKey,
      addressLine: '', city: c.city, cityLower: lower(c.city), state: c.state, zipCode: c.zip,
      firstJobAt: dateISO, lastJobAt: dateISO, lastJobId: jobId, jobCount: 1,
      lifetimeRevenue: c.revenue, averageTicket: c.revenue,
      customerStatus: 'Active', vipTier: vipTier(c.revenue),
      generalNotes: c.note, createdByUid: uid, processedJobIds: [jobId],
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }, { merge: true });

    await setDoc(doc(db, 'businesses', BID, 'customers', customerId, 'vehicles', vehicleId), {
      // businessId is the denormalized tenant id REQUIRED by the vehicles
      // create rule (cross-tenant-leak guard) — must equal the path tenant.
      businessId: BID,
      year: c.vehicleYear, make: c.vehicleMake, model: c.vehicleModel,
      makeModelLower: lower(`${c.vehicleMake} ${c.vehicleModel}`),
      vehicleMakeModel: `${c.vehicleYear} ${c.vehicleMake} ${c.vehicleModel}`,
      vehicleType: c.vehicleType, tireSize: c.tireSize,
      lastServicedAt: dateISO, lastServiceDate: dateISO, lastJobId: jobId, serviceCount: 1,
      processedJobIds: [jobId], createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }, { merge: true });

    const amountPaid = c.paymentStatus === 'Paid' ? c.revenue : 0;
    await setDoc(doc(db, 'businesses', BID, 'jobs', jobId), {
      id: jobId, date: dateISO, status: c.status, paymentStatus: c.paymentStatus,
      ...(amountPaid ? { amountPaid, paymentMethod: c.payMethod } : {}),
      ...(scheduled ? { appointmentDate: isoDateTimeDaysAhead(-c.daysAgo) } : {}),
      service: c.service, source: c.source,
      vehicleType: c.vehicleType, vehicleMakeModel: `${c.vehicleYear} ${c.vehicleMake} ${c.vehicleModel}`,
      customerName: fullName, customerPhone: c.phone, customerId, vehicleId, phoneKey: pKey,
      addressLine: '', city: c.city, state: c.state, zipCode: c.zip, area: c.city,
      fullLocationLabel: `${c.city}, ${c.state}`,
      tireSize: c.tireSize, qty: c.qty, revenue: c.revenue,
      tireCost: Math.round(c.revenue * 0.4), materialCost: 15, miles: 12,
      createdByUid: uid, assignedToUid: uid,
      createdAt: serverTimestamp(), lastEditedAt: serverTimestamp(),
    }, { merge: true });

    console.log(`[appreview]   job: ${fullName} · ${c.service} · ${c.tireSize} ×${c.qty} · $${c.revenue} · ${c.status}/${c.paymentStatus}`);
  }

  // ─── 5. Inventory ─────────────────────────────────────────────────
  for (const it of DEMO_INVENTORY) {
    const invId = `inv-${it.size.replace(/[^\dR]/g, '')}`;
    await setDoc(doc(db, 'businesses', BID, 'inventory', invId), {
      id: invId, size: it.size, qty: it.qty, cost: it.cost, brand: it.brand,
      reorderPoint: it.reorderPoint, condition: 'New',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }, { merge: true });
    console.log(`[appreview]   inventory: ${it.size} ×${it.qty} @ $${it.cost} (${it.brand})`);
  }

  console.log(`\n[appreview] DONE.`);
  console.log(`[appreview]   Email:    ${EMAIL}`);
  console.log(`[appreview]   Password: (the APPREVIEW_PASSWORD you passed)`);
  console.log(`[appreview]   Tenant:   businesses/${BID} (isolated; businessId === uid)`);
  console.log(`[appreview]   Seeded:   ${DEMO_JOBS.length} jobs/customers, ${DEMO_INVENTORY.length} inventory items`);

  await deleteApp(app);
}

void main().catch((err) => {
  console.error('[appreview] FAILED:', err);
  process.exit(1);
});
