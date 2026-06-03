import { useState } from 'react';
import { useBrand } from '@/context/BrandContext';
import { usePermissions } from '@/context/MembershipContext';
import { addToast } from '@/lib/toast';
import { _auth, fbSet, scopedCol } from '@/lib/firebase';
import {
  signOut,
  updatePassword,
  deleteUser,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  EmailAuthProvider,
  GoogleAuthProvider,
} from 'firebase/auth';
import { AccordionShell } from '@/components/settings/AccordionShell';

// ─────────────────────────────────────────────────────────────────────
//  Account accordion
// ─────────────────────────────────────────────────────────────────────

export function AccountAccordion({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const email = _auth?.currentUser?.email || '';
  // Provider id reflects Google/Apple/etc. Default Firebase email/password
  // signups report as 'password'. Surface that as 'Email' for readability.
  const providerId = _auth?.currentUser?.providerData?.[0]?.providerId;
  const provider = providerId === 'password' ? 'Email' : (providerId || 'Email');
  const summary = email ? `${email} · ${provider}` : 'Not signed in';

  return (
    <AccordionShell title="Account" icon="🔐" summary={summary} open={open} onToggle={onToggle}>
      <AccountForm />
    </AccordionShell>
  );
}

function AccountForm() {
  const { businessId } = useBrand();
  const permissions = usePermissions();
  const [newPass, setNewPass] = useState('');
  const [busy, setBusy] = useState(false);

  // Deletion modal state — gated behind a typed confirmation. For
  // password-auth users we ALSO require the password (re-auth). For
  // Google-auth users we re-auth via popup. Both paths are required
  // by Firebase for sensitive ops (account deletion).
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [reauthPass, setReauthPass] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const changePass = async () => {
    if (!_auth?.currentUser) return;
    if (newPass.length < 6) { addToast('Password too short', 'warn'); return; }
    setBusy(true);
    try {
      await updatePassword(_auth.currentUser, newPass);
      addToast('Password updated', 'success');
      setNewPass('');
    } catch (e) {
      addToast((e as Error).message || 'Update failed', 'error');
    } finally { setBusy(false); }
  };

  const logout = async () => {
    if (!_auth) return;
    try { await signOut(_auth); } catch { /* */ }
  };

  // ─── Account deletion ──────────────────────────────────────────────
  //
  // Flow:
  //  1. User taps "Delete my account" → modal opens
  //  2. User types DELETE to confirm intent
  //  3. (a) If password-auth: re-auth with password
  //     (b) If Google-auth: reauthenticateWithPopup(GoogleAuthProvider)
  //  4. Write a `deletedAt` marker to the business doc (so backups
  //     reflect the deletion request — admin can purge data within
  //     30 days per Privacy Policy)
  //  5. Call deleteUser(currentUser) — removes the Firebase Auth record
  //  6. User is signed out automatically by Firebase after delete
  //
  // Owner vs technician:
  //  - OWNER (canManageBilling): deletes the WHOLE business (auth + all data
  //    via the deletedAt marker)
  //  - ADMIN/TECHNICIAN: deletes only their own auth account + their
  //    member doc; the business itself stays intact for the owner
  //
  // The actual hard-deletion of business data is performed by an
  // admin process within 30 days (per Privacy Policy §6). This UI
  // sets the deletedAt marker that drives that purge.
  const performDelete = async () => {
    if (!_auth?.currentUser) return;
    if (confirmText.trim().toUpperCase() !== 'DELETE') {
      addToast('Type DELETE to confirm', 'warn');
      return;
    }
    setDeleteBusy(true);
    try {
      const u = _auth.currentUser;
      const providerId = u.providerData?.[0]?.providerId;

      // Step 1: re-authenticate (Firebase requires this for delete).
      if (providerId === 'password') {
        if (!u.email || !reauthPass) {
          throw new Error('Enter your password to confirm');
        }
        const cred = EmailAuthProvider.credential(u.email, reauthPass);
        await reauthenticateWithCredential(u, cred);
      } else if (providerId === 'google.com') {
        await reauthenticateWithPopup(u, new GoogleAuthProvider());
      } else {
        throw new Error(`Re-authentication not supported for provider: ${providerId || 'unknown'}`);
      }

      // Step 2: write deletion marker. If owner, mark the business
      // for purge. Otherwise mark only the member doc.
      const now = new Date().toISOString();
      if (businessId) {
        try {
          if (permissions.canManageBilling) {
            const bizCol = scopedCol(businessId, '');
            // scopedCol uses businesses/{bid}/{name} — we need the root
            // business doc itself, so fall back to direct setDoc.
            // (Unable to use scopedCol for root.)
            // Use fbSet on a synthetic 'meta' subcollection to record the
            // deletion request — safe regardless of root-doc write rules.
            const metaCol = scopedCol(businessId, 'meta');
            await fbSet(metaCol, 'deletion-request', {
              requestedAt: now,
              requestedBy: u.uid,
              requestedEmail: u.email || '',
              scope: 'business',
              // P2 audit fix (2026-06-03): sentinel field that the
              // scheduledDeletionPurge collectionGroup query filters
              // on. Prevents junk meta docs (e.g. future placeholder
              // signals) from being counted against the purge-per-run
              // quota.
              marker: 'deletion-request',
            });
            // Best-effort: also try to set a marker on the business root
            // doc. If rules block this, the meta doc above is enough
            // signal for the admin purge process.
            if (bizCol) {
              try {
                // bizCol is technically a subcollection ref ('businesses/{bid}/'),
                // not the root doc. We rely on the meta doc above as the
                // canonical signal.
              } catch { /* */ }
            }
          } else {
            // Non-owner: just mark the member doc as left.
            const memberCol = scopedCol(businessId, 'members');
            await fbSet(memberCol, u.uid, {
              leftAt: now,
              status: 'left',
            });
          }
        } catch (markerErr) {
          // Don't block the auth deletion on Firestore failure — the
          // user clearly wants out. Log + continue.
          console.warn('[delete] failed to write deletion marker:', markerErr);
        }
      }

      // Step 3: delete the Firebase Auth record.
      await deleteUser(u);

      // Step 4: user is signed out automatically. Toast for clarity.
      addToast('Account deleted. Goodbye 👋', 'success');
      // Firebase usually signs the user out on delete, but force it
      // for any edge case where the listener doesn't fire.
      try { if (_auth) await signOut(_auth); } catch { /* */ }
    } catch (e) {
      const msg = (e as Error).message || 'Delete failed';
      // Firebase wraps password failures in long codes; humanize.
      const friendly = /wrong-password|invalid-credential/i.test(msg)
        ? 'Incorrect password — try again.'
        : /popup-closed|cancelled/i.test(msg)
          ? 'Sign-in popup closed — try again to confirm.'
          : /requires-recent-login/i.test(msg)
            ? 'Sign out and back in, then try again (security check).'
            : msg;
      addToast(friendly, 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  const providerId = _auth?.currentUser?.providerData?.[0]?.providerId;
  const needsPassword = providerId === 'password';
  const isOwner = permissions.canManageBilling;
  // Verification status — only relevant for email/password users.
  // Google sign-ins are pre-verified by Firebase.
  const emailVerified = Boolean(_auth?.currentUser?.emailVerified);
  const showVerifyRow = providerId === 'password' && !emailVerified;
  const [verifyBusy, setVerifyBusy] = useState(false);

  const resendVerify = async () => {
    if (!_auth?.currentUser) return;
    setVerifyBusy(true);
    try {
      await sendEmailVerification(_auth.currentUser);
      addToast('Verification email sent — check your inbox', 'success');
    } catch (e) {
      const msg = (e as Error).message || 'Failed to send';
      const friendly = /too-many-requests/i.test(msg)
        ? 'Hold on — too many attempts. Try again in a few minutes.'
        : msg;
      addToast(friendly, 'error');
    } finally {
      setVerifyBusy(false);
    }
  };

  return (
    <>
      <div className="field">
        <label htmlFor="settings-account-email">Email</label>
        <input id="settings-account-email" value={_auth?.currentUser?.email || ''} disabled />
      </div>
      {showVerifyRow && (
        <div style={{
          marginTop: -8, marginBottom: 14,
          padding: '8px 10px',
          background: 'rgba(245,158,11,.1)',
          border: '1px solid rgba(245,158,11,.3)',
          borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 11,
        }}>
          <span style={{ flex: 1, color: 'var(--t2)' }}>
            ⚠ Email not yet verified
          </span>
          <button
            onClick={resendVerify}
            disabled={verifyBusy}
            style={{
              padding: '4px 10px',
              background: 'var(--brand-primary)',
              color: '#000',
              border: 'none', borderRadius: 6,
              fontSize: 11, fontWeight: 800,
              cursor: 'pointer',
              opacity: verifyBusy ? 0.5 : 1,
            }}
          >
            Resend
          </button>
        </div>
      )}
      <div className="field">
        <label htmlFor="settings-account-new-password">New password</label>
        <input id="settings-account-new-password" type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="At least 6 characters" />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn secondary" onClick={changePass} disabled={busy || !newPass} style={{ flex: 1 }}>
          Update password
        </button>
        <button className="btn danger" onClick={logout} style={{ flex: 1 }}>Sign out</button>
      </div>

      {/* Danger zone — account deletion. Clearly separated visually so
          it doesn't get tapped by accident. */}
      <div style={{
        marginTop: 22, paddingTop: 14,
        borderTop: '1px solid var(--border)',
      }}>
        <div style={{
          fontSize: 10, fontWeight: 800,
          color: 'rgb(239,68,68)', textTransform: 'uppercase', letterSpacing: 1.2,
          marginBottom: 8,
        }}>
          Danger Zone
        </div>
        <div style={{ fontSize: 11, color: 'var(--t3)', lineHeight: 1.5, marginBottom: 10 }}>
          {isOwner
            ? 'Permanently delete your account and request removal of all business data. '
            : 'Permanently delete your account and leave this business. '}
          This action cannot be undone. Per our Privacy Policy, business
          data is removed from active systems within 30 days.
        </div>
        <button
          onClick={() => { setShowDeleteModal(true); setConfirmText(''); setReauthPass(''); }}
          style={{
            width: '100%',
            padding: '10px 12px',
            background: 'transparent',
            color: 'rgb(239,68,68)',
            border: '1px solid rgba(239,68,68,.4)',
            borderRadius: 8,
            fontSize: 12, fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Delete my account
        </button>
      </div>

      {/* Legal links — direct routes via ?legal= URL param, opens the
          PrivacyTerms page in the same window. Visible to all roles
          including technicians (who otherwise only see this accordion). */}
      <div style={{
        marginTop: 18, paddingTop: 14,
        borderTop: '1px solid var(--border)',
        display: 'flex', gap: 12, justifyContent: 'center',
        fontSize: 11, flexWrap: 'wrap',
      }}>
        <a
          href="?legal=privacy"
          style={{ color: 'var(--t3)', textDecoration: 'none' }}
        >
          Privacy Policy
        </a>
        <span style={{ color: 'var(--t3)' }}>·</span>
        <a
          href="?legal=terms"
          style={{ color: 'var(--t3)', textDecoration: 'none' }}
        >
          Terms of Service
        </a>
        <span style={{ color: 'var(--t3)' }}>·</span>
        <a
          href="?help=1"
          style={{ color: 'var(--t3)', textDecoration: 'none' }}
        >
          Help
        </a>
        <span style={{ color: 'var(--t3)' }}>·</span>
        <a
          href="mailto:info@mobileserviceos.app"
          style={{ color: 'var(--t3)', textDecoration: 'none' }}
        >
          Support
        </a>
      </div>

      {/* Deletion confirmation modal */}
      {showDeleteModal && (
        <div
          onClick={() => !deleteBusy && setShowDeleteModal(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.65)',
            zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 420,
              background: 'var(--s1)',
              border: '1px solid rgba(239,68,68,.3)',
              borderRadius: 14,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--t1)', marginBottom: 8 }}>
              Delete account?
            </div>
            <div style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.5, marginBottom: 14 }}>
              {isOwner
                ? <>You are the <strong>owner</strong>. Deleting your account will request removal of your business and all jobs, customers, invoices, and inventory data. This cannot be undone.</>
                : <>Deleting your account will sign you out of this business. Your created jobs will remain visible to the owner but no longer associated with your login.</>}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', display: 'block', marginBottom: 4 }}>
                Type DELETE to confirm
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                autoCapitalize="characters"
                autoComplete="off"
                style={{
                  width: '100%', padding: '8px 10px',
                  background: 'var(--s2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8, color: 'var(--t1)',
                  fontSize: 13, letterSpacing: 1,
                }}
              />
            </div>

            {needsPassword && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', display: 'block', marginBottom: 4 }}>
                  Your password
                </label>
                <input
                  type="password"
                  value={reauthPass}
                  onChange={(e) => setReauthPass(e.target.value)}
                  placeholder="Required to confirm"
                  autoComplete="current-password"
                  style={{
                    width: '100%', padding: '8px 10px',
                    background: 'var(--s2)',
                    border: '1px solid var(--border)',
                    borderRadius: 8, color: 'var(--t1)',
                    fontSize: 13,
                  }}
                />
              </div>
            )}

            {!needsPassword && providerId === 'google.com' && (
              <div style={{
                fontSize: 11, color: 'var(--t3)', lineHeight: 1.4,
                background: 'var(--s2)',
                padding: '8px 10px', borderRadius: 8,
                marginBottom: 12,
              }}>
                You'll be asked to sign in with Google again to confirm.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleteBusy}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  background: 'var(--s2)',
                  color: 'var(--t1)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 13, fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={performDelete}
                disabled={
                  deleteBusy
                  || confirmText.trim().toUpperCase() !== 'DELETE'
                  || (needsPassword && !reauthPass)
                }
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  background: 'rgb(239,68,68)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 13, fontWeight: 800,
                  cursor: 'pointer',
                  opacity: (deleteBusy || confirmText.trim().toUpperCase() !== 'DELETE' || (needsPassword && !reauthPass)) ? 0.5 : 1,
                }}
              >
                {deleteBusy ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
