import { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────
//  PrivacyTerms — Privacy Policy + Terms of Service
//
//  Standard SaaS legal boilerplate, customized to Mobile Service OS:
//  - Mobile tire/roadside SaaS context
//  - Sole-proprietorship operating under "Mobile Service OS"
//  - Florida governing law
//  - Stripe payment processor
//  - Firebase infrastructure
//  - info@mobileserviceos.app contact
//
//  Reachable from:
//    - AuthScreen footer ("Privacy · Terms")
//    - Settings → Account section ("View Privacy Policy / Terms")
//    - Direct URL ?legal=privacy or ?legal=terms (shareable links)
//
//  IMPORTANT: This is good-faith soft-launch boilerplate. It covers
//  the legal essentials needed to begin charging early customers and
//  satisfies Stripe + App Store baseline requirements. It is NOT a
//  substitute for review by a licensed attorney before scaling past
//  ~20 paid customers or processing sensitive PII beyond basic
//  business contact info and payment processing via Stripe.
// ─────────────────────────────────────────────────────────────────────

type Tab = 'privacy' | 'terms';

interface Props {
  /** Which doc to show on mount. Defaults to 'privacy'. */
  initialTab?: Tab;
  /** Called when the user taps the back arrow. If provided, navigates
   *  back via the parent (e.g. clear ?legal=) rather than history. */
  onBack?: () => void;
}

const LAST_UPDATED = '2026-05-14';
const ENTITY_NAME = 'Mobile Service OS';
const ENTITY_TYPE = 'a sole proprietorship';
const STATE = 'Florida';
const CONTACT_EMAIL = 'info@mobileserviceos.app';
const PRODUCT = 'Mobile Service OS';
const PRODUCT_URL = 'https://app.mobileserviceos.app';

export function PrivacyTerms({ initialTab = 'privacy', onBack }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);

  // Sync ?legal=privacy ↔ ?legal=terms so the URL stays shareable as
  // the user toggles tabs.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('legal', tab);
    window.history.replaceState(null, '', url.toString());
  }, [tab]);

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
          Legal
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{
        display: 'flex', gap: 6,
        background: 'var(--s2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 4, marginBottom: 18,
      }}>
        <TabButton active={tab === 'privacy'} onClick={() => setTab('privacy')}>
          Privacy Policy
        </TabButton>
        <TabButton active={tab === 'terms'} onClick={() => setTab('terms')}>
          Terms of Service
        </TabButton>
      </div>

      {tab === 'privacy' ? <PrivacyDoc /> : <TermsDoc />}

      <div style={{
        marginTop: 28, paddingTop: 16,
        borderTop: '1px solid var(--border)',
        fontSize: 11, color: 'var(--t3)', textAlign: 'center',
      }}>
        Last updated: {LAST_UPDATED} · Questions?{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--brand-primary)' }}>
          {CONTACT_EMAIL}
        </a>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '10px 12px',
        background: active ? 'var(--s1)' : 'transparent',
        border: active ? '1px solid var(--border2)' : '1px solid transparent',
        borderRadius: 8,
        color: active ? 'var(--t1)' : 'var(--t3)',
        fontSize: 13, fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

// ─── Shared document chrome ──────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h2 style={{
        fontSize: 14, fontWeight: 800, color: 'var(--t1)',
        marginBottom: 8, marginTop: 0,
      }}>
        {title}
      </h2>
      <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.65 }}>
        {children}
      </div>
    </div>
  );
}

// ─── Privacy Policy ──────────────────────────────────────────────────

function PrivacyDoc() {
  return (
    <article>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--t1)', marginTop: 0, marginBottom: 16 }}>
        Privacy Policy
      </h1>
      <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.65, marginBottom: 22 }}>
        This Privacy Policy describes how {ENTITY_NAME} ({ENTITY_TYPE},
        referred to here as &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) collects, uses, and
        protects information when you use {PRODUCT} (the &ldquo;Service&rdquo;),
        available at <a href={PRODUCT_URL} style={{ color: 'var(--brand-primary)' }}>{PRODUCT_URL}</a>.
      </p>

      <Section title="1. Information We Collect">
        <p style={{ marginTop: 0 }}>
          We collect information you provide directly when you use the Service:
        </p>
        <ul style={{ marginTop: 8, marginBottom: 8, paddingLeft: 20 }}>
          <li><strong>Account information</strong>: email address, password (encrypted), and authentication provider (e.g., Google).</li>
          <li><strong>Business information</strong>: business name, address, phone number, service area, branding, and business settings you configure.</li>
          <li><strong>Operational data</strong>: jobs, customer records (name, phone, address), inventory, expenses, invoices, and payments you record in the Service.</li>
          <li><strong>Team information</strong>: names, emails, and roles of technicians or admins you invite to your account.</li>
          <li><strong>Payment information</strong>: when you subscribe, payment is processed by Stripe, Inc. We do <em>not</em> store credit card numbers or banking details; only a Stripe customer ID and subscription status.</li>
          <li><strong>Technical data</strong>: device type, browser, IP address (collected by our hosting providers for security and abuse prevention), and basic error logs.</li>
        </ul>
      </Section>

      <Section title="2. How We Use Your Information">
        <p style={{ marginTop: 0 }}>
          We use the information we collect to:
        </p>
        <ul style={{ marginTop: 8, marginBottom: 8, paddingLeft: 20 }}>
          <li>Provide, operate, and maintain the Service;</li>
          <li>Process subscription payments and prevent fraud;</li>
          <li>Authenticate users and protect accounts from unauthorized access;</li>
          <li>Communicate with you about account-related matters, service updates, and support inquiries;</li>
          <li>Diagnose and fix bugs or service issues;</li>
          <li>Comply with legal obligations.</li>
        </ul>
        <p>
          We do <strong>not</strong> sell your personal information. We do not use your business data
          (jobs, customers, inventory) for advertising or share it with third
          parties for marketing purposes.
        </p>
      </Section>

      <Section title="3. Subprocessors">
        <p style={{ marginTop: 0 }}>
          We rely on industry-standard third-party services to operate the Service:
        </p>
        <ul style={{ marginTop: 8, marginBottom: 8, paddingLeft: 20 }}>
          <li><strong>Google Firebase</strong> (authentication, database, storage, hosting)</li>
          <li><strong>Stripe, Inc.</strong> (payment processing)</li>
          <li><strong>GitHub</strong> (code hosting and build infrastructure)</li>
        </ul>
        <p>
          Each subprocessor maintains its own privacy and security practices,
          which are publicly available on their respective websites.
        </p>
      </Section>

      <Section title="4. Data Storage and Security">
        <p style={{ marginTop: 0 }}>
          Your data is stored on Google Firebase infrastructure within the United States.
          We use industry-standard encryption (TLS in transit, AES-256 at rest)
          and role-based access controls to protect your information. While we
          take reasonable precautions, no method of transmission or storage is
          100% secure, and we cannot guarantee absolute security.
        </p>
      </Section>

      <Section title="5. Your Rights">
        <p style={{ marginTop: 0 }}>
          You have the right to:
        </p>
        <ul style={{ marginTop: 8, marginBottom: 8, paddingLeft: 20 }}>
          <li><strong>Access</strong> the personal data we hold about you;</li>
          <li><strong>Export</strong> your business data in a portable format;</li>
          <li><strong>Correct</strong> inaccurate data through the Service settings;</li>
          <li><strong>Delete</strong> your account and all associated data;</li>
          <li><strong>Object</strong> to or restrict certain processing activities.</li>
        </ul>
        <p>
          To exercise any of these rights, email us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--brand-primary)' }}>{CONTACT_EMAIL}</a>.
          We will respond within 30 days.
        </p>
      </Section>

      <Section title="6. Account Deletion">
        <p style={{ marginTop: 0 }}>
          You may request deletion of your account at any time by emailing{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--brand-primary)' }}>{CONTACT_EMAIL}</a>.
          Upon deletion, your business records (jobs, customers, inventory,
          invoices) will be removed from active systems within 30 days. Backups
          containing your data may persist for up to 90 additional days before
          being purged, after which the data is permanently destroyed.
          Authentication records (email, sign-in metadata) may be retained
          longer if required to comply with legal obligations, prevent fraud,
          or resolve disputes.
        </p>
      </Section>

      <Section title="7. Children's Privacy">
        <p style={{ marginTop: 0 }}>
          The Service is intended for use by businesses and their employees who
          are at least 18 years of age. We do not knowingly collect personal
          information from children under 13. If you believe a child has
          provided personal information, please contact us and we will delete
          the information.
        </p>
      </Section>

      <Section title="8. Cookies and Tracking">
        <p style={{ marginTop: 0 }}>
          We use only essential cookies and local storage required for the
          Service to function — for example, to keep you signed in. We do not
          use third-party analytics or advertising trackers. We do not respond
          to Do Not Track signals because we do not track users across other
          websites.
        </p>
      </Section>

      <Section title="9. International Users">
        <p style={{ marginTop: 0 }}>
          The Service is operated from the United States. If you access the
          Service from outside the U.S., you consent to the transfer of your
          information to the United States, which may have different data
          protection laws than your country of residence.
        </p>
      </Section>

      <Section title="10. Changes to This Policy">
        <p style={{ marginTop: 0 }}>
          We may update this Privacy Policy from time to time. We will notify
          you of material changes by email or through a notice in the Service.
          Continued use of the Service after changes constitutes acceptance of
          the revised policy.
        </p>
      </Section>

      <Section title="11. Contact">
        <p style={{ marginTop: 0 }}>
          Questions or concerns about this Privacy Policy? Email us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--brand-primary)' }}>{CONTACT_EMAIL}</a>.
        </p>
      </Section>
    </article>
  );
}

// ─── Terms of Service ───────────────────────────────────────────────

function TermsDoc() {
  return (
    <article>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--t1)', marginTop: 0, marginBottom: 16 }}>
        Terms of Service
      </h1>
      <p style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.65, marginBottom: 22 }}>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of {PRODUCT}{' '}
        (the &ldquo;Service&rdquo;), operated by {ENTITY_NAME} ({ENTITY_TYPE},
        &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;). By creating an
        account or using the Service, you agree to be bound by these Terms.
      </p>

      <Section title="1. Eligibility">
        <p style={{ marginTop: 0 }}>
          You must be at least 18 years old and authorized to bind your
          business to these Terms. The Service is intended for use by
          professional service businesses (e.g., mobile tire, roadside,
          automotive repair) and their employees.
        </p>
      </Section>

      <Section title="2. Account Registration">
        <p style={{ marginTop: 0 }}>
          You agree to provide accurate, current, and complete information
          during registration and to keep your account information up to date.
          You are responsible for safeguarding your password and for all
          activities under your account. Notify us immediately at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--brand-primary)' }}>{CONTACT_EMAIL}</a>{' '}
          of any unauthorized use.
        </p>
      </Section>

      <Section title="3. Subscriptions and Payment">
        <p style={{ marginTop: 0 }}>
          The Service is provided on a subscription basis. By subscribing, you
          authorize us (through our payment processor, Stripe) to charge the
          payment method you provide on a recurring basis until you cancel.
        </p>
        <p>
          Subscription fees are non-refundable except as expressly stated in
          these Terms or required by applicable law. Cancellations take effect
          at the end of the current billing period; you retain access to paid
          features until then.
        </p>
        <p>
          We may change subscription pricing with at least 30 days' notice. If
          you do not agree to a price change, you may cancel before it takes
          effect.
        </p>
      </Section>

      <Section title="4. Acceptable Use">
        <p style={{ marginTop: 0 }}>
          You agree NOT to:
        </p>
        <ul style={{ marginTop: 8, marginBottom: 8, paddingLeft: 20 }}>
          <li>Use the Service for any unlawful purpose or in violation of these Terms;</li>
          <li>Attempt to gain unauthorized access to other accounts or systems;</li>
          <li>Interfere with or disrupt the Service or servers;</li>
          <li>Reverse engineer, decompile, or attempt to extract the source code;</li>
          <li>Use the Service to send spam, phishing, or fraudulent communications;</li>
          <li>Upload content that is illegal, infringing, or harmful;</li>
          <li>Resell, sublicense, or commercially exploit the Service without our written consent.</li>
        </ul>
      </Section>

      <Section title="5. Your Content and Data">
        <p style={{ marginTop: 0 }}>
          You retain full ownership of the business data you enter into the
          Service (jobs, customers, inventory, invoices, settings). We claim
          no ownership interest in this data.
        </p>
        <p>
          You grant us a limited license to host, process, and display your
          data solely for the purpose of providing the Service to you. You are
          solely responsible for the accuracy of data you enter and for
          obtaining any consents required from your customers to store their
          information in the Service.
        </p>
      </Section>

      <Section title="6. Service Availability">
        <p style={{ marginTop: 0 }}>
          We aim to keep the Service available 24/7 but do not guarantee
          uninterrupted access. Scheduled maintenance, third-party outages
          (e.g., Firebase, Stripe), or unforeseen events may cause downtime.
          We are not liable for losses caused by such interruptions.
        </p>
      </Section>

      <Section title="7. Disclaimers">
        <p style={{ marginTop: 0 }}>
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT
          WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY,
          FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. WE DO NOT
          WARRANT THAT THE SERVICE WILL BE ERROR-FREE OR THAT DEFECTS WILL BE
          CORRECTED.
        </p>
        <p>
          The Service includes pricing calculators, suggested rates, and
          financial reports. These are tools to assist your business; we make
          no representations about the accuracy of any specific result. You
          remain responsible for verifying calculations and complying with
          applicable laws (tax, labor, consumer protection, etc.).
        </p>
      </Section>

      <Section title="8. Limitation of Liability">
        <p style={{ marginTop: 0 }}>
          TO THE FULLEST EXTENT PERMITTED BY LAW, {ENTITY_NAME.toUpperCase()} SHALL NOT BE
          LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
          PUNITIVE DAMAGES, INCLUDING LOST PROFITS, LOST DATA, OR BUSINESS
          INTERRUPTION, ARISING OUT OF OR IN CONNECTION WITH THE SERVICE,
          EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
        </p>
        <p>
          IN NO EVENT SHALL OUR AGGREGATE LIABILITY EXCEED THE GREATER OF
          (a) THE AMOUNT YOU PAID US FOR THE SERVICE IN THE TWELVE (12) MONTHS
          PRECEDING THE CLAIM, OR (b) ONE HUNDRED DOLLARS ($100 USD).
        </p>
      </Section>

      <Section title="9. Indemnification">
        <p style={{ marginTop: 0 }}>
          You agree to defend, indemnify, and hold harmless {ENTITY_NAME} from any
          claims, damages, liabilities, or expenses (including reasonable
          attorneys' fees) arising from (a) your use of the Service,
          (b) your violation of these Terms, or (c) your violation of any
          third-party rights, including your customers' rights.
        </p>
      </Section>

      <Section title="10. Termination">
        <p style={{ marginTop: 0 }}>
          You may cancel your account at any time through the Service settings
          or by emailing{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--brand-primary)' }}>{CONTACT_EMAIL}</a>.
        </p>
        <p>
          We may suspend or terminate your account if you violate these Terms,
          fail to pay subscription fees, or engage in fraudulent or abusive
          behavior. Upon termination, your right to use the Service ends
          immediately. Data retention after termination is described in our
          Privacy Policy.
        </p>
      </Section>

      <Section title="11. Modifications to the Service">
        <p style={{ marginTop: 0 }}>
          We may modify, add, or remove features of the Service at any time.
          We will provide reasonable notice of material changes affecting
          paid subscribers.
        </p>
      </Section>

      <Section title="12. Modifications to These Terms">
        <p style={{ marginTop: 0 }}>
          We may update these Terms from time to time. Material changes will
          be communicated by email or through a notice in the Service.
          Continued use after the effective date of the revised Terms
          constitutes acceptance.
        </p>
      </Section>

      <Section title="13. Governing Law and Disputes">
        <p style={{ marginTop: 0 }}>
          These Terms are governed by the laws of the State of {STATE}, USA,
          without regard to its conflict of law principles. Any dispute arising
          from these Terms or the Service shall be resolved exclusively in the
          state or federal courts located in {STATE}, and you consent to the
          personal jurisdiction of those courts.
        </p>
      </Section>

      <Section title="14. Severability">
        <p style={{ marginTop: 0 }}>
          If any provision of these Terms is found to be unenforceable, the
          remaining provisions shall remain in full force and effect.
        </p>
      </Section>

      <Section title="15. Entire Agreement">
        <p style={{ marginTop: 0 }}>
          These Terms, together with the Privacy Policy, constitute the entire
          agreement between you and {ENTITY_NAME} concerning the Service and
          supersede all prior agreements and understandings.
        </p>
      </Section>

      <Section title="16. Contact">
        <p style={{ marginTop: 0 }}>
          Questions about these Terms? Email{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--brand-primary)' }}>{CONTACT_EMAIL}</a>.
        </p>
      </Section>
    </article>
  );
}
