import { SERVICE_PHRASES } from '@/lib/defaults';

export function buildReviewMsg(
  url: string,
  customerName: string,
  service: string,
  city: string,
  brandName: string
): string {
  const name = (customerName || '').trim();
  const greet = name ? 'Hi ' + name + ',' : 'Hi,';
  const svc = SERVICE_PHRASES[service] || (service ? service.toLowerCase() : 'tire service');
  const cityStr = (city || '').trim() || 'your area';
  return (
    greet +
    ' thanks again for choosing ' +
    (brandName || 'our team') +
    '. If you have a minute, please leave us a quick review here:\n\n' +
    url +
    '\n\nIf possible, please mention the ' +
    svc +
    ' in ' +
    cityStr +
    '. It helps our local business.'
  );
}

export function openReviewSMS(
  phone: string,
  url: string,
  customerName: string,
  service: string,
  city: string,
  brandName: string
): void {
  const msg = encodeURIComponent(buildReviewMsg(url, customerName, service, city, brandName));
  const ph = (phone || '').replace(/\D/g, '');
  window.open(ph ? `sms:${ph}?body=${msg}` : `sms:?body=${msg}`);
}
