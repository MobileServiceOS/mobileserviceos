// src/components/customers/VehiclesSection.tsx
// ═══════════════════════════════════════════════════════════════════
//  VehiclesSection — list of all vehicles for a customer.
//
//  Spec: §"Customer Profile sections → Vehicles"
//  Reads: businesses/{bid}/customers/{cid}/vehicles ordered by
//  lastServicedAt desc, limit 10. Real-time onSnapshot.
// ═══════════════════════════════════════════════════════════════════

import {
  memo,
  useEffect,
  useState,
  type CSSProperties } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { requireDb } from '@/lib/firebase';
import type { Vehicle } from '@/lib/customerEntity';

interface Props {
  businessId: string;
  customerId: string;
}

function VehiclesSectionImpl({ businessId, customerId }: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId || !customerId) return;
    const col = collection(requireDb(), 'businesses', businessId, 'customers', customerId, 'vehicles');
    const q = query(col, orderBy('lastServicedAt', 'desc'), limit(10));
    const unsub = onSnapshot(q,
      (snap) => {
        const rows: Vehicle[] = [];
        snap.forEach(d => rows.push({ id: d.id, ...d.data() } as unknown as Vehicle));
        setVehicles(rows);
        setLoading(false);
      },
      (err) => {
        console.warn('[VehiclesSection] listen failed', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [businessId, customerId]);

  return (
    <section className="form-group card-anim" aria-label="Vehicles">
      <div className="form-group-title">Vehicles {!loading && <span style={{ fontWeight: 400, color: 'var(--t3)', fontSize: 11 }}>({vehicles.length})</span>}</div>
      {loading && <div style={{ color: 'var(--t3)', fontSize: 12 }}>Loading…</div>}
      {!loading && vehicles.length === 0 && (
        <div style={{ color: 'var(--t3)', fontSize: 12 }}>No vehicles yet — created automatically on first job.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {vehicles.map(v => (
          <div key={v.id} style={vehicleCardStyle}>
            <div style={{ fontWeight: 600, color: 'var(--t1)', fontSize: 14 }}>
              {[v.year, v.make, v.model, v.trim].filter(Boolean).join(' ') || v.vehicleMakeModel || v.id}
            </div>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 4 }}>
              {v.tireSize && <span>Tire: {v.tireSize}{v.alternateTireSize ? ` / ${v.alternateTireSize}` : ''}</span>}
              {v.color && <span> · {v.color}</span>}
              {v.licensePlate && <span> · Plate: {v.licensePlate}</span>}
            </div>
            {(v.wheelLockNotes || v.tpmsNotes) && (
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
                {v.wheelLockNotes && <div>🔑 {v.wheelLockNotes}</div>}
                {v.tpmsNotes && <div>📡 TPMS: {v.tpmsNotes}</div>}
              </div>
            )}
            {v.lastServicedAt && (
              <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
                Last serviced: {new Date(v.lastServicedAt).toLocaleDateString()}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

const vehicleCardStyle: CSSProperties = {
  padding: 10,
  background: 'var(--s2, #1f1f1f)',
  border: '1px solid var(--border, #2a2a2a)',
  borderRadius: 8,
};

export const VehiclesSection = memo(VehiclesSectionImpl);
