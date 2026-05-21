// src/lib/openMessagingUri.ts
// ═══════════════════════════════════════════════════════════════════
//  sms: / mailto: URI helpers for the tap-to-send flow. Browsers
//  handle URI-scheme handoff to the OS's SMS / email app; this
//  module just builds the URIs and triggers the navigation.
//
//  We use a programmatic anchor click rather than window.location.href
//  because some mobile browsers block scheme-handoff on direct
//  location.href assignment.
// ═══════════════════════════════════════════════════════════════════

export function buildSmsUri(toPhone: string, body: string): string {
  const phone = String(toPhone || '').replace(/[^0-9+]/g, '');
  return `sms:${phone}?&body=${encodeURIComponent(body)}`;
}

export function buildMailtoUri(toEmail: string, subject: string, body: string): string {
  const email = String(toEmail || '').trim();
  const subj = encodeURIComponent(subject);
  const bod = encodeURIComponent(body);
  return `mailto:${email}?subject=${subj}&body=${bod}`;
}

export function openMessagingUri(uri: string): void {
  const a = document.createElement('a');
  a.href = uri;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 0);
}
