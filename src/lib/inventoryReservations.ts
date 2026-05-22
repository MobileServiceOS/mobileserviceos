// src/lib/inventoryReservations.ts
// ═══════════════════════════════════════════════════════════════════
//  Reserved-inventory pure helpers (roadmap inventory upgrade —
//  Phase 3).
//
//  An InventoryItem can carry a `reservations: ReservedSlot[]` array
//  earmarking some of its qty for upcoming work. availableQty is
//  derived: qty − sum(slot.qty), clamped to 0. v1 stores a free-text
//  label per slot; auto-release / jobId linkage are out of scope.
//
//  All helpers are pure — they never mutate their input.
//
//  Spec: docs/superpowers/specs/2026-05-22-inventory-operations-design.md
// ═══════════════════════════════════════════════════════════════════

import type { InventoryItem, ReservedSlot } from '@/types';
import { uid } from '@/lib/utils';

export function reservedQty(item: InventoryItem): number {
  if (!Array.isArray(item.reservations)) return 0;
  let sum = 0;
  for (const slot of item.reservations) {
    const q = Number(slot?.qty);
    if (Number.isFinite(q) && q > 0) sum += q;
  }
  return sum;
}

export function availableQty(item: InventoryItem): number {
  return Math.max(0, Number(item.qty || 0) - reservedQty(item));
}

export function addReservation(
  item: InventoryItem,
  qty: number,
  label?: string,
  now?: string,
): InventoryItem {
  if (!Number.isFinite(qty) || qty <= 0) return item;
  if (qty > availableQty(item)) return item;
  const slot: ReservedSlot = {
    id: uid(),
    qty,
    createdAt: now || new Date().toISOString(),
  };
  if (label && label.trim()) slot.label = label.trim();
  const reservations = [...(item.reservations || []), slot];
  return { ...item, reservations };
}

export function removeReservation(
  item: InventoryItem,
  reservationId: string,
): InventoryItem {
  if (!Array.isArray(item.reservations)) return { ...item };
  const reservations = item.reservations.filter((r) => r.id !== reservationId);
  if (reservations.length === item.reservations.length) return { ...item };
  // Drop the field entirely when empty so consumers can treat
  // "no reservations" as undefined.
  return reservations.length ? { ...item, reservations } : { ...item, reservations: undefined };
}
