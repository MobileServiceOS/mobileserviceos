// src/lib/bandilero/services/dispatch.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Dispatch / ETA service (DETERMINISTIC, no LLM).
//
//  Jobs now carry optional GPS coordinates (lat/lng), captured by the
//  AddJob "Use my location" button (Bandilero Phase 2). Dispatch is
//  honest about data completeness:
//    • geocoded-coverage of today's scheduled jobs → LIVE (a real count,
//      even 0).
//    • route distance / drive time across today's geocoded jobs →
//      ESTIMATED (straight-line haversine + an assumed average speed,
//      stated inline). There is no live tech-GPS or routing API, so
//      this is explicitly a model, not a measured ETA.
//    • when fewer than 2 of today's jobs are geocoded → NOT_CONNECTED,
//      never a fabricated distance.
// ═══════════════════════════════════════════════════════════════════

import type { Job } from '@/types';
import { type Metric, live, estimated, notConnected } from '../confidence';

function round1(n: number): number {
  return Math.round((Number(n) || 0) * 10) / 10;
}

/** Assumed average road speed for the straight-line ETA model (mph). */
export const ASSUMED_AVG_SPEED_MPH = 30;

/** Haversine great-circle distance in miles between two coordinates. */
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // earth radius, miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hasCoords(j: Job): j is Job & { lat: number; lng: number } {
  return Number.isFinite(j.lat as number) && Number.isFinite(j.lng as number);
}

/** Today's non-cancelled jobs. */
function scheduledToday(jobs: ReadonlyArray<Job>, today: string): Job[] {
  return (jobs || []).filter((j) => j.date === today && j.status !== 'Cancelled');
}

export interface DispatchMetrics {
  /** Count of today's scheduled jobs that have GPS coordinates. LIVE. */
  geocodedToday: Metric<number>;
  /** Percent of today's scheduled jobs that are geocoded. LIVE. */
  coveragePct: Metric<number>;
  /** Straight-line route miles across today's geocoded jobs. ESTIMATED. */
  routeMiles: Metric<number>;
  /** Modeled drive time (min) for that route at the assumed speed. ESTIMATED. */
  driveTimeMin: Metric<number>;
}

/**
 * Straight-line route distance across today's geocoded jobs, in array
 * order. Returns the summed haversine miles between consecutive points.
 */
export function routeMilesToday(jobs: ReadonlyArray<Job>, today: string): number {
  const pts = scheduledToday(jobs, today).filter(hasCoords);
  let miles = 0;
  for (let i = 1; i < pts.length; i++) {
    miles += haversineMiles(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
  }
  return round1(miles);
}

export function dispatchMetrics(jobs: ReadonlyArray<Job>, today: string): DispatchMetrics {
  const sched = scheduledToday(jobs, today);
  const geo = sched.filter(hasCoords);

  const geocodedToday = live(geo.length, 'jobs', today);
  const coveragePct = live(sched.length > 0 ? Math.round((geo.length / sched.length) * 100) : 0, 'jobs', today);

  if (geo.length < 2) {
    const nc = () => notConnected<number>('Need ≥2 geocoded jobs today — capture job locations via "Use my location"', 'jobs');
    return { geocodedToday, coveragePct, routeMiles: nc(), driveTimeMin: nc() };
  }

  const miles = routeMilesToday(jobs, today);
  const driveMin = Math.round((miles / ASSUMED_AVG_SPEED_MPH) * 60);
  const assume = `straight-line distance across ${geo.length} geocoded jobs at an assumed ${ASSUMED_AVG_SPEED_MPH} mph`;
  return {
    geocodedToday,
    coveragePct,
    routeMiles: estimated(miles, assume, 'jobs', today),
    driveTimeMin: estimated(driveMin, assume, 'jobs', today),
  };
}
