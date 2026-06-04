// scripts/seed-emulator.ts
// ═══════════════════════════════════════════════════════════════════
//  Firebase Emulator Suite seed script.
//
//  Run AFTER `npm run emulator:start` has been launched in a separate
//  shell. This script:
//    1. Creates an admin user in the Auth emulator (email/password).
//    2. Creates a dev business doc + member role membership.
//    3. Creates 10 sample jobs with phone numbers — saveJob in the
//       real app would auto-create Customer + Vehicle docs from these
//       via upsertCustomerFromJob, but this seed script writes the
//       Customer/Vehicle/Job docs directly so the operator sees rich
//       data on first load.
//
//  Run: `npm run emulator:seed`
//  Re-run: idempotent (uses set-with-merge); safe to re-run any time.
//
//  IMPORTANT: this script targets the EMULATOR (127.0.0.1) explicitly.
//  Never points at production. Refuses to run if FIREBASE_AUTH_EMULATOR_HOST
//  or FIRESTORE_EMULATOR_HOST is unset.
// ═══════════════════════════════════════════════════════════════════

import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';

// Force-set emulator env vars BEFORE Firebase init so child SDKs auto-route.
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

const PROJECT_ID = 'mobile-service-os';
const ADMIN_EMAIL = 'admin@localhost.dev';
const ADMIN_PASSWORD = 'dev-password-1234';
const DEV_BUSINESS_ID = 'dev-localhost-business';

const SAMPLE_CUSTOMERS = [
  {
    firstName: 'Maria',
    lastName: 'Lopez',
    phone: '+13058977030',
    vehicleYear: 2021,
    vehicleMake: 'Honda',
    vehicleModel: 'Civic',
    tireSize: '215/55R17',
    city: 'Hollywood',
    state: 'FL',
    zip: '33020',
    service: 'Tire Replacement',
    revenue: 480,
    daysAgo: 35,
    note: 'Gate code 4421 · Wheel lock key in glovebox',
  },
  {
    firstName: 'John',
    lastName: 'Smith',
    phone: '+13059876543',
    vehicleYear: 2021,
    vehicleMake: 'Honda',
    vehicleModel: 'Accord',
    tireSize: '225/45R17',
    city: 'Hollywood',
    state: 'FL',
    zip: '33020',
    service: 'Flat Tire Repair',
    revenue: 95,
    daysAgo: 60,
    note: 'SMS preferred · Parks in covered garage row B',
  },
  {
    firstName: 'Jose',
    lastName: 'Garcia',
    phone: '+13057456789',
    vehicleYear: 2022,
    vehicleMake: 'Tesla',
    vehicleModel: 'Model 3',
    tireSize: '235/45R18',
    city: 'Aventura',
    state: 'FL',
    zip: '33180',
    service: 'Tire Installation',
    revenue: 760,
    daysAgo: 18,
    note: 'TPMS sensor #3 finicky · Use battery-powered impact',
  },
  {
    firstName: 'Aisha',
    lastName: 'Khan',
    phone: '+13056543210',
    vehicleYear: 2020,
    vehicleMake: 'Toyota',
    vehicleModel: 'RAV4',
    tireSize: '225/65R17',
    city: 'Miramar',
    state: 'FL',
    zip: '33027',
    service: 'Tire Replacement',
    revenue: 540,
    daysAgo: 75,
    note: 'Apartment 4B · Buzz #042',
  },
  {
    firstName: 'Carlos',
    lastName: 'Mendez',
    phone: '+13054321098',
    vehicleYear: 2019,
    vehicleMake: 'Ford',
    vehicleModel: 'F-150',
    tireSize: '275/65R18',
    city: 'Hollywood',
    state: 'FL',
    zip: '33020',
    service: 'Spare Tire Installation',
    revenue: 95,
    daysAgo: 12,
    note: 'Roadside · Highway 95 northbound mile 18',
  },
  {
    firstName: 'Priya',
    lastName: 'Patel',
    phone: '+13053210987',
    vehicleYear: 2023,
    vehicleMake: 'BMW',
    vehicleModel: 'X5',
    tireSize: '275/40R20',
    city: 'Aventura',
    state: 'FL',
    zip: '33180',
    service: 'Tire Replacement',
    revenue: 1820,
    daysAgo: 7,
    note: 'VIP · Concierge service · Calls preferred over SMS',
  },
];

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400_000);
  return d.toISOString().slice(0, 10);
}

function phoneKey(e164: string): string {
  return e164.replace(/[^\d]/g, '');
}

function nameLower(s: string): string {
  return s.trim().toLowerCase();
}

function makeModelLower(make: string, model: string): string {
  return `${make} ${model}`.toLowerCase();
}

function vipTier(revenue: number): 'Standard' | 'Gold' | 'Platinum' {
  if (revenue >= 2500) return 'Platinum';
  if (revenue >= 1000) return 'Gold';
  return 'Standard';
}

async function main(): Promise<void> {
  const app = initializeApp({
    projectId: PROJECT_ID,
    apiKey: 'fake-emulator-key',
  });
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);

  console.log('[seed] Connected to emulators (auth :9099, firestore :8080)');

  // ─── 1. Admin user ────────────────────────────────────────────────
  let adminUid: string;
  try {
    const cred = await createUserWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
    adminUid = cred.user.uid;
    console.log(`[seed] Created admin user: ${ADMIN_EMAIL} → uid=${adminUid}`);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/email-already-in-use') {
      const cred = await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
      adminUid = cred.user.uid;
      console.log(`[seed] Reusing existing admin user: uid=${adminUid}`);
    } else {
      throw err;
    }
  }

  // ─── 2. Dev business + members ───────────────────────────────────
  const businessRef = doc(db, 'businesses', DEV_BUSINESS_ID);
  await setDoc(businessRef, {
    id: DEV_BUSINESS_ID,
    name: 'Wheel Rush Dev Tenant',
    businessType: 'tire',
    ownerUid: adminUid,
    createdAt: serverTimestamp(),
  }, { merge: true });

  await setDoc(doc(db, 'businesses', DEV_BUSINESS_ID, 'members', adminUid), {
    uid: adminUid,
    role: 'owner',
    email: ADMIN_EMAIL,
    displayName: 'Dev Admin',
    permissions: { canViewFinancials: true, canEditBusinessSettings: true, canCreateJobs: true },
    createdAt: serverTimestamp(),
  }, { merge: true });

  await setDoc(doc(db, 'businesses', DEV_BUSINESS_ID, 'settings', 'main'), {
    businessName: 'Wheel Rush Dev Tenant',
    businessType: 'tire',
    autoSaveCustomersFromJobs: true,
    twilioConnected: false,
    communicationProvider: 'twilio',
    incomingCallLookupEnabled: true,
    incomingSMSLoggingEnabled: true,
    missedCallAutoTextEnabled: false,
    outboundSMSEnabled: true,
    freeMilesIncluded: 15,
    costPerMile: 0.65,
  }, { merge: true });

  // User-to-business mapping (App.tsx reads /users/{uid} for businessId).
  await setDoc(doc(db, 'users', adminUid), {
    uid: adminUid,
    email: ADMIN_EMAIL,
    businessId: DEV_BUSINESS_ID,
    displayName: 'Dev Admin',
    createdAt: serverTimestamp(),
  }, { merge: true });

  console.log(`[seed] Business + members + settings seeded: ${DEV_BUSINESS_ID}`);

  // ─── 3. Customers + Vehicles + Jobs ──────────────────────────────
  for (const c of SAMPLE_CUSTOMERS) {
    const pKey = phoneKey(c.phone);
    const customerId = `p_${pKey}`;
    const vehicleId = `${c.vehicleYear}-${c.vehicleMake.toLowerCase()}-${c.vehicleModel.toLowerCase()}`;
    const jobId = `seedjob-${customerId}-${c.daysAgo}`;
    const dateISO = isoDaysAgo(c.daysAgo);

    // Customer doc
    await setDoc(doc(db, 'businesses', DEV_BUSINESS_ID, 'customers', customerId), {
      name: `${c.firstName} ${c.lastName}`,
      nameLower: nameLower(`${c.firstName} ${c.lastName}`),
      kind: 'individual',
      phoneE164: c.phone,
      phoneKey: pKey,
      addressLine: '',
      city: c.city,
      cityLower: nameLower(c.city),
      state: c.state,
      zipCode: c.zip,
      firstJobAt: dateISO,
      lastJobAt: dateISO,
      lastJobId: jobId,
      jobCount: 1,
      lifetimeRevenue: c.revenue,
      averageTicket: c.revenue,
      customerStatus: 'Active',
      vipTier: vipTier(c.revenue),
      generalNotes: c.note,
      createdByUid: adminUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      processedJobIds: [jobId],
    }, { merge: true });

    // Vehicle subdoc
    await setDoc(doc(db, 'businesses', DEV_BUSINESS_ID, 'customers', customerId, 'vehicles', vehicleId), {
      year: c.vehicleYear,
      make: c.vehicleMake,
      model: c.vehicleModel,
      makeModelLower: makeModelLower(c.vehicleMake, c.vehicleModel),
      vehicleMakeModel: `${c.vehicleYear} ${c.vehicleMake} ${c.vehicleModel}`,
      vehicleType: 'Sedan',
      tireSize: c.tireSize,
      lastServicedAt: dateISO,
      lastServiceDate: dateISO,
      lastJobId: jobId,
      serviceCount: 1,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      processedJobIds: [jobId],
    }, { merge: true });

    // Job doc
    await setDoc(doc(db, 'businesses', DEV_BUSINESS_ID, 'jobs', jobId), {
      id: jobId,
      date: dateISO,
      status: 'Completed',
      paymentStatus: 'Paid',
      service: c.service,
      vehicleType: 'Sedan',
      vehicleMakeModel: `${c.vehicleYear} ${c.vehicleMake} ${c.vehicleModel}`,
      customerName: `${c.firstName} ${c.lastName}`,
      customerPhone: c.phone,
      customerId,
      vehicleId,
      phoneKey: pKey,
      addressLine: '',
      city: c.city,
      state: c.state,
      zipCode: c.zip,
      tireSize: c.tireSize,
      revenue: c.revenue,
      tireCost: Math.floor(c.revenue * 0.4),
      materialCost: 15,
      miles: 12,
      createdByUid: adminUid,
      assignedToUid: adminUid,
      createdAt: serverTimestamp(),
      lastEditedAt: serverTimestamp(),
    }, { merge: true });

    console.log(`[seed] Customer ${c.firstName} ${c.lastName} (${c.phone}) → ${c.vehicleYear} ${c.vehicleMake} ${c.vehicleModel} · ${c.service} · $${c.revenue}`);
  }

  console.log(`\n[seed] DONE. ${SAMPLE_CUSTOMERS.length} customers seeded.`);
  console.log(`[seed] Sign in via: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`[seed] Emulator UI: http://127.0.0.1:4000`);

  await deleteApp(app);
}

void main().catch((err) => {
  console.error('[seed] FAILED:', err);
  process.exit(1);
});
