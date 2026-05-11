import { SERVICE_PHRASES } from '@/lib/defaults';

/**
 * Build a review-request SMS body.
 *
 * Format matches the spec:
 *   "Thanks for choosing [Business Name]. If you have a moment, a quick
 *    review mentioning [service] in [city, state] would really help our
 *    local business."
 *
 * `location` may be a plain city ("Hollywood"), a pre-combined label
 * ("Hollywood, FL"), or empty. Pass an optional `state` to append ", ST"
 * when location doesn't already contain a comma.
 */
export function buildReviewMsg(
  url: string,
  customerName: string,
  service: string,
  location: string,
  brandName: string,
  state?: string
): string {
  const name = (customerName || '').trim();
  const greet = name ? 'Hi ' + name + ',' : 'Hi,';
  const svc = SERVICE_PHRASES[service] || (service ? service.toLowerCase() : 'tire service');
  let loc = (location || '').trim();
  const st = (state || '').trim();
  if (loc && st && !loc.includes(',')) loc = `${loc}, ${st}`;
  if (!loc) loc = 'your area';
  const biz = brandName || 'our team';
  return (
    greet +
    ' thanks for choosing ' +
    biz +
    '. If you have a moment, a quick review mentioning ' +
    svc +
    ' in ' +
    loc +
    ' would really help our local business:\n\n' +
    url
  );
}

export function openReviewSMS(
  phone: string,
  url: string,
  customerName: string,
  service: string,
  location: string,
  brandName: string,
  state?: string
): void {
  const msg = encodeURIComponent(buildReviewMsg(url, customerName, service, location, brandName, state));
  const ph = (phone || '').replace(/\D/g, '');
  window.open(ph ? `sms:${ph}?body=${msg}` : `sms:?body=${msg}`);
}
