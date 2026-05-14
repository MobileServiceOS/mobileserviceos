import { useMemo, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────
//  Help — in-app FAQ + support center
//
//  Operator-focused answers covering the common pain points:
//    - Getting started (first job, first invoice)
//    - Pricing engine (suggested vs premium, surcharges)
//    - Inventory (deductions, low-stock alerts)
//    - Team (invites, roles, permissions)
//    - Billing (subscription, lifetime, account deletion)
//    - Account (password, verification, sign-out)
//    - Privacy & legal (data ownership, contact)
//
//  Searchable: type in the field at top → only items matching the
//  query string (in title or body) remain visible.
//
//  All content is bundled into the JS so it works offline. No external
//  CMS or fetched docs — this is fine for the soft-launch stage with
//  <50 paid customers. If FAQ count grows past ~40 items, migrate to
//  a fetched JSON or markdown source.
// ─────────────────────────────────────────────────────────────────────

interface FaqItem {
  /** Stable ID for anchor links + dedup. */
  id: string;
  /** Group it belongs to (rendered as a section header). */
  category: string;
  /** Question. */
  q: string;
  /** Answer — rendered as React node, so links/strong/em are allowed. */
  a: React.ReactNode;
}

const SUPPORT_EMAIL = 'info@mobileserviceos.app';

const FAQ: FaqItem[] = [
  // ─── Getting started ────────────────────────────────────────────
  {
    id: 'gs-first-job',
    category: 'Getting started',
    q: 'How do I log my first job?',
    a: (
      <>
        Tap the gold <strong>＋ Log</strong> button at the bottom. Fill in
        revenue, miles, tire cost, then pick the service and vehicle.
        The suggested price updates live at the top. Tap <strong>Save</strong> when done.
        Quick Quote on the Dashboard does the same math without saving anything — useful when
        you're on the phone with a customer.
      </>
    ),
  },
  {
    id: 'gs-onboarding',
    category: 'Getting started',
    q: 'Can I change my business name, logo, or service area after onboarding?',
    a: (
      <>
        Yes. Open <strong>More → Settings → Brand</strong> and{' '}
        <strong>Business</strong>. You can update the business name,
        phone, address, primary city, service radius, logo, and brand
        color any time. Changes sync automatically and apply to all
        invoices and the customer-facing screens.
      </>
    ),
  },
  {
    id: 'gs-week-start',
    category: 'Getting started',
    q: 'Why does my weekly profit start on Monday?',
    a: (
      <>
        Monday is the default work-week start, but it's configurable.
        Open <strong>Settings → Business → Work week starts on</strong> and
        pick Sunday through Saturday. The Dashboard hero and Payouts
        rollups will recalculate immediately.
      </>
    ),
  },

  // ─── Jobs & quoting ─────────────────────────────────────────────
  {
    id: 'jq-suggested-vs-premium',
    category: 'Jobs & Quoting',
    q: 'What\'s the difference between suggested and premium pricing?',
    a: (
      <>
        <strong>Suggested</strong> = direct costs (tire, material, travel)
        plus your target profit, rounded up to the nearest $5. It's the
        floor for what you should charge.
        <br /><br />
        <strong>Premium</strong> = 25% more, for high-urgency calls or
        out-of-area jobs. Useful when the customer says yes immediately
        or asks "how much" without negotiating.
      </>
    ),
  },
  {
    id: 'jq-tire-cost',
    category: 'Jobs & Quoting',
    q: 'Where do I enter tire cost?',
    a: (
      <>
        In the <strong>Revenue</strong> section at the top of Log Job — right
        next to Miles. It's now always visible regardless of service type.
        If tire source is set to "Customer supplied" it's automatically locked at $0.
      </>
    ),
  },
  {
    id: 'jq-surcharges',
    category: 'Jobs & Quoting',
    q: 'What do the surcharges (Emergency, Late, Hwy, Wknd) actually add?',
    a: (
      <>
        Flat dollar amounts on top of the suggested price:
        <ul style={{ marginTop: 6, marginBottom: 6, paddingLeft: 20 }}>
          <li><strong>Emergency</strong> +$30</li>
          <li><strong>Late Night</strong> +$25</li>
          <li><strong>Highway</strong> +$20</li>
          <li><strong>Weekend</strong> +$15</li>
        </ul>
        These are flat additions, not percentages. They stack — an
        emergency-late-night-highway call adds $75 on top of base.
      </>
    ),
  },
  {
    id: 'jq-revenue-locked',
    category: 'Jobs & Quoting',
    q: 'Why is the revenue field locked for my technician?',
    a: (
      <>
        By default, technicians cannot override the suggested price.
        Owners can enable manual overrides under{' '}
        <strong>Settings → Business → Allow technicians to override job price</strong>.
        Once enabled, technicians get an editable revenue field and a "Use suggested"
        button to snap to the recommended price.
      </>
    ),
  },
  {
    id: 'jq-edit-pricing',
    category: 'Jobs & Quoting',
    q: 'How do I change the base price for a service?',
    a: (
      <>
        Open <strong>Settings → Pricing</strong>. Each service has a base price and
        a target profit. Adjust either to change what the suggested-price
        calculator returns. You can also disable services you don't offer.
      </>
    ),
  },

  // ─── Inventory ──────────────────────────────────────────────────
  {
    id: 'inv-deduction',
    category: 'Inventory',
    q: 'When does inventory get deducted from a job?',
    a: (
      <>
        When you save a job with <strong>tire source: Inventory</strong>, the system
        finds matching tire sizes in your stock and reduces the quantity
        using FIFO (oldest stock first). The deduction is recorded on
        the job in case you need to reverse it later by editing.
      </>
    ),
  },
  {
    id: 'inv-low-stock',
    category: 'Inventory',
    q: 'How does Low Stock Alert work?',
    a: (
      <>
        The Dashboard highlights tire sizes that were sold often recently
        but have ≤1 unit left on hand. Only the top 3 sizes are shown to
        keep the alert focused. Open the Inventory tab to restock.
      </>
    ),
  },
  {
    id: 'inv-bulk-upload',
    category: 'Inventory',
    q: 'Can I bulk-upload inventory?',
    a: (
      <>
        Yes. <strong>Inventory tab → Bulk Upload</strong>. The CSV format is shown
        in the upload modal — size, brand, qty, cost, sell price.
        Preview before commit so you can fix mistakes.
      </>
    ),
  },

  // ─── Team ───────────────────────────────────────────────────────
  {
    id: 'team-invite',
    category: 'Team',
    q: 'How do I invite a technician?',
    a: (
      <>
        Open <strong>Settings → Team → Invite member</strong>. Enter their email and
        pick the role (technician or admin). You'll get a share link
        that opens straight to a branded signup page. They sign up,
        and they're automatically added to your business with the
        right permissions.
      </>
    ),
  },
  {
    id: 'team-roles',
    category: 'Team',
    q: 'What\'s the difference between owner, admin, and technician?',
    a: (
      <>
        <strong>Owner</strong>: full access — billing, settings, team, all data.
        <br />
        <strong>Admin</strong>: operational control — pricing, jobs, inventory, team —
        but not billing.
        <br />
        <strong>Technician</strong>: log jobs, use Quick Quote, see only their own
        jobs and earnings. No financial visibility, no settings access
        beyond Account.
      </>
    ),
  },
  {
    id: 'team-remove',
    category: 'Team',
    q: 'How do I remove a technician?',
    a: (
      <>
        Open <strong>Settings → Team → Active Members</strong>. Tap the row and
        select <strong>Remove</strong>. They lose access on their next page load.
        Their historical jobs stay in the system attributed to their
        original signup but no longer linked to a live account.
      </>
    ),
  },
  {
    id: 'team-tech-goal',
    category: 'Team',
    q: 'Can I set a custom weekly jobs goal for technicians?',
    a: (
      <>
        Yes. <strong>Settings → Business → Technician weekly jobs goal</strong> — defaults
        to 5. This drives the progress ring on each technician's
        Dashboard. Their hero shows X/Y jobs completed.
      </>
    ),
  },

  // ─── Billing ────────────────────────────────────────────────────
  {
    id: 'bill-cancel',
    category: 'Billing',
    q: 'How do I cancel my subscription?',
    a: (
      <>
        Email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--brand-primary)' }}>{SUPPORT_EMAIL}</a>
        {' '}with the subject line "Cancel subscription" and the email associated with
        your account. We'll cancel within one business day. You keep
        access until the end of the current billing period.
        Self-service cancellation through the Stripe Customer Portal
        is coming soon.
      </>
    ),
  },
  {
    id: 'bill-card-failed',
    category: 'Billing',
    q: 'What happens if my card fails?',
    a: (
      <>
        Stripe will retry automatically for several days. You'll get
        emails from Stripe with a link to update your card. If retries
        don't succeed, your subscription pauses until you update payment
        — at which point full access restores. Your business data
        is preserved during the pause.
      </>
    ),
  },
  {
    id: 'bill-refund',
    category: 'Billing',
    q: 'What\'s your refund policy?',
    a: (
      <>
        Subscription fees are non-refundable, but we'll consider
        exceptions on a case-by-case basis if you've been charged but
        haven't actively used the service. Email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--brand-primary)' }}>{SUPPORT_EMAIL}</a>
        {' '}within 14 days of the charge.
      </>
    ),
  },

  // ─── Account ────────────────────────────────────────────────────
  {
    id: 'acc-verify',
    category: 'Account',
    q: 'Why does it say my email isn\'t verified?',
    a: (
      <>
        Email verification protects your account if your password is
        compromised. Check your inbox (and spam folder) for the
        verification link we sent when you signed up. If it didn't
        arrive, tap <strong>Resend</strong> on the banner at the top of the app or
        in <strong>Settings → Account</strong>.
      </>
    ),
  },
  {
    id: 'acc-delete',
    category: 'Account',
    q: 'How do I delete my account?',
    a: (
      <>
        Open <strong>Settings → Account</strong>, scroll to <strong>Danger Zone</strong>, and tap{' '}
        <strong>Delete my account</strong>. You'll type DELETE and re-enter
        your password (or re-authenticate with Google) to confirm.
        Per our Privacy Policy, business data is removed from active
        systems within 30 days. Backups purge within 90 additional days.
      </>
    ),
  },
  {
    id: 'acc-password',
    category: 'Account',
    q: 'How do I change my password?',
    a: (
      <>
        <strong>Settings → Account → New password</strong>. Type a new password
        (at least 6 characters) and tap Update password. Firebase
        may ask you to re-authenticate if it's been a while since
        your last sign-in.
      </>
    ),
  },

  // ─── Privacy & legal ────────────────────────────────────────────
  {
    id: 'legal-data',
    category: 'Privacy & Legal',
    q: 'Who owns the data in my account?',
    a: (
      <>
        You do. Jobs, customers, inventory, invoices — full ownership
        stays with you. We host and process the data to provide the
        service but make no ownership claim. See the{' '}
        <a href="?legal=terms" style={{ color: 'var(--brand-primary)' }}>Terms of Service</a> §5.
      </>
    ),
  },
  {
    id: 'legal-export',
    category: 'Privacy & Legal',
    q: 'Can I export my data?',
    a: (
      <>
        Email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--brand-primary)' }}>{SUPPORT_EMAIL}</a>
        {' '}requesting a data export. We'll provide a JSON file of all your jobs,
        inventory, customers, and settings within 7 business days at no charge.
        Self-service export is on the roadmap.
      </>
    ),
  },
  {
    id: 'legal-stripe',
    category: 'Privacy & Legal',
    q: 'Do you store my credit card?',
    a: (
      <>
        No. All payment processing is handled by Stripe. We only store
        a Stripe customer ID and your subscription status — never card
        numbers, CVVs, or banking details.
      </>
    ),
  },

  // ─── Troubleshooting ────────────────────────────────────────────
  {
    id: 'ts-sync',
    category: 'Troubleshooting',
    q: 'The Synced pill turned red or shows Offline — what now?',
    a: (
      <>
        That means the app can't reach Firestore. Most often it's a
        weak signal at a roadside call. Your changes are queued
        locally and sync automatically when connectivity returns.
        If the failure persists when you have a clean signal,
        sign out and back in. If that doesn't help, email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--brand-primary)' }}>{SUPPORT_EMAIL}</a>.
      </>
    ),
  },
  {
    id: 'ts-mobile',
    category: 'Troubleshooting',
    q: 'How do I install the app to my home screen?',
    a: (
      <>
        <strong>iOS Safari:</strong> tap the share icon at the bottom, then "Add to
        Home Screen". The app icon will appear next to your other
        apps and run full-screen.
        <br /><br />
        <strong>Android Chrome:</strong> tap the three-dot menu, then "Add to Home Screen" or "Install app".
        <br /><br />
        Once installed, the app works the same as a native app — no app store needed.
      </>
    ),
  },
  {
    id: 'ts-contact',
    category: 'Troubleshooting',
    q: 'I have a question that isn\'t covered here.',
    a: (
      <>
        Email{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--brand-primary)' }}>{SUPPORT_EMAIL}</a>
        {' '}with a description and a screenshot if relevant. We respond
        within one business day for paying customers, two for free
        trials.
      </>
    ),
  },
];

const CATEGORIES = Array.from(new Set(FAQ.map((f) => f.category)));

interface Props {
  /** Optional back handler (used when the page is rendered inside the
   *  main app via the More sheet). When omitted, no back button shows
   *  — useful for the public ?help=1 URL. */
  onBack?: () => void;
}

export function Help({ onBack }: Props) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQ;
    return FAQ.filter((f) => {
      // Search title + serialized answer (React nodes are stringified
      // via JSON.stringify which is approximate but good enough for
      // simple substring matching of plain text within JSX).
      const hay = (f.q + ' ' + (typeof f.a === 'string' ? f.a : JSON.stringify(f.a))).toLowerCase();
      return hay.includes(q);
    });
  }, [query]);

  // Group filtered items by category, preserving the canonical order.
  const grouped = useMemo(() => {
    const m: Record<string, FaqItem[]> = {};
    filtered.forEach((f) => {
      if (!m[f.category]) m[f.category] = [];
      m[f.category].push(f);
    });
    return CATEGORIES.map((cat) => ({ cat, items: m[cat] || [] })).filter((g) => g.items.length > 0);
  }, [filtered]);

  return (
    <div className="page page-enter" style={{
      maxWidth: 760, margin: '0 auto',
      padding: '14px 14px calc(40px + env(safe-area-inset-bottom)) 14px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        gap: 10, marginBottom: 14,
      }}>
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            style={{
              border: '1px solid var(--border)',
              background: 'var(--s2)',
              color: 'var(--t1)',
              width: 36, height: 36, borderRadius: 10,
              fontSize: 18, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ‹
          </button>
        )}
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--t1)' }}>
          Help & FAQ
        </div>
      </div>

      <div style={{ marginBottom: 18 }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help…"
          aria-label="Search help articles"
          style={{
            width: '100%',
            padding: '10px 12px',
            background: 'var(--s2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            color: 'var(--t1)',
            fontSize: 14,
          }}
        />
      </div>

      {grouped.length === 0 && (
        <div style={{
          padding: '20px 16px',
          background: 'var(--s2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          textAlign: 'center',
          color: 'var(--t3)',
          fontSize: 13, lineHeight: 1.5,
        }}>
          Nothing matches "{query}".<br />
          Email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--brand-primary)' }}>{SUPPORT_EMAIL}</a>
          {' '}for direct help.
        </div>
      )}

      {grouped.map(({ cat, items }) => (
        <section key={cat} style={{ marginBottom: 18 }}>
          <div style={{
            fontSize: 10, fontWeight: 800,
            color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1.5,
            marginBottom: 8, paddingLeft: 4,
          }}>
            {cat}
          </div>
          <div style={{
            background: 'var(--s2)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden',
          }}>
            {items.map((item, idx) => {
              const isOpen = openId === item.id;
              return (
                <div key={item.id} style={{
                  borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
                }}>
                  <button
                    onClick={() => setOpenId(isOpen ? null : item.id)}
                    aria-expanded={isOpen}
                    style={{
                      width: '100%', textAlign: 'left',
                      padding: '12px 14px',
                      background: isOpen ? 'var(--s1)' : 'transparent',
                      border: 'none',
                      color: 'var(--t1)',
                      fontSize: 13, fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}
                  >
                    <span style={{ flex: 1 }}>{item.q}</span>
                    <span style={{
                      fontSize: 16, color: 'var(--t3)',
                      transform: isOpen ? 'rotate(90deg)' : 'none',
                      transition: 'transform 200ms',
                    }}>
                      ›
                    </span>
                  </button>
                  {isOpen && (
                    <div style={{
                      padding: '4px 14px 14px 14px',
                      fontSize: 12, color: 'var(--t2)', lineHeight: 1.6,
                    }}>
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {/* Bottom contact card */}
      <div style={{
        marginTop: 24, padding: '14px 16px',
        background: 'var(--s2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', marginBottom: 4 }}>
          Still stuck?
        </div>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 10, lineHeight: 1.5 }}>
          Email us — we respond within one business day.
        </div>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          style={{
            display: 'inline-block',
            padding: '8px 16px',
            background: 'var(--brand-primary)',
            color: '#000',
            borderRadius: 8,
            fontSize: 12, fontWeight: 800,
            textDecoration: 'none',
          }}
        >
          {SUPPORT_EMAIL}
        </a>
      </div>
    </div>
  );
}
