// functions/src/lib/geo.ts
// ═══════════════════════════════════════════════════════════════════
//  geo — server-side forward geocoding (OpenStreetMap Nominatim).
//
//  Used as the last fallback in the payment location chain: when neither
//  the Zettle purchase nor the matched job has coordinates, geocode the
//  job's address so location verification + the map still work. Free,
//  keyless — same provider the client already uses for reverse geocode.
//  Best-effort: returns null on any failure (the caller degrades to an
//  address-only verification block).
// ═══════════════════════════════════════════════════════════════════

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

export async function geocodeAddress(query: string): Promise<{ lat: number; lng: number } | null> {
  const q = query.trim();
  if (!q) return null;
  const url = `${NOMINATIM}?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MobileServiceOS/1.0 (payment location verification)' },
    });
    if (!res.ok) return null;
    const arr = await res.json() as Array<{ lat?: string; lon?: string }>;
    const hit = Array.isArray(arr) ? arr[0] : undefined;
    if (!hit?.lat || !hit?.lon) return null;
    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}
