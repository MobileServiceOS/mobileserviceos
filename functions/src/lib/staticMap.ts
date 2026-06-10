// functions/src/lib/staticMap.ts
// ═══════════════════════════════════════════════════════════════════
//  staticMap — render a verification map pin as a base64 PNG data URI.
//
//  OSM-based free tier (Geoapify by default — 3k req/day free). The key
//  lives in MAP_STATIC_API_KEY (Secret Manager); it NEVER reaches the
//  client because the map is rendered server-side and stored on the
//  owner/admin-only zettlePayments doc.
//
//  Best-effort: returns null when no key is set or the request fails, so
//  location verification still works (address-only) without a map. The
//  result is capped well under Firestore's 1 MB document limit.
// ═══════════════════════════════════════════════════════════════════

const MAX_BYTES = 700_000; // keep the data URI comfortably under 1 MB

export async function generateStaticMapDataUri(lat: number, lng: number): Promise<string | null> {
  const key = process.env.MAP_STATIC_API_KEY;
  if (!key) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const marker = `lonlat:${lng},${lat};type:material;color:%23e74c3c;size:large`;
  const url =
    'https://maps.geoapify.com/v1/staticmap'
    + '?style=osm-bright&width=640&height=320'
    + `&center=lonlat:${lng},${lat}&zoom=16`
    + `&marker=${marker}`
    + `&apiKey=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
