import { useEffect, useState } from 'react';
import { collection, getFirestore, onSnapshot, deleteDoc, doc, type Unsubscribe } from 'firebase/firestore';
import type { InviteDoc, MemberDoc, Role } from '@/types';
import { useBrand } from '@/context/BrandContext';
import { usePermissions } from '@/context/MembershipContext';
import { addToast } from '@/lib/toast';
import {
  createInvite,
  revokeInvite,
  subscribePendingInvites,
  buildInviteLink,
  sendInviteEmail,
} from '@/lib/invites';

// ─────────────────────────────────────────────────────────────────────
//  TeamManagement
//
//  Three sections inside the Team accordion in Settings:
//
//    1. Invite form — email + role picker + "Send invite" button.
//       Tries email send first; if it fails, surfaces a copy-link
//       fallback. Both paths end at the same accept flow.
//
//    2. Pending invites — list of un-accepted invites. Each row has
//       a "Copy link" and "Revoke" button. Live-updated via
//       Firestore onSnapshot.
//
//    3. Active members — list of accepted members with role badges.
//       Owner row is non-removable; other roles can be removed by
//       the owner. Live-updated via onSnapshot.
//
//  Permissions: requires canManageTeam from MembershipContext. The
//  parent (Settings.tsx → TeamAccordion) should gate visibility; this
//  component additionally renders a permission-denied notice if
//  somehow loaded by a non-admin user.
// ─────────────────────────────────────────────────────────────────────

export function TeamManagement() {
  const { businessId, brand } = useBrand();
  const permissions = usePermissions();

  if (!permissions.canManageTeam) {
    return (
      <div style={{
        padding: 14, background: 'var(--s2)',
        border: '1px solid var(--border)', borderRadius: 10,
        fontSize: 12, color: 'var(--t3)', lineHeight: 1.5,
      }}>
        You don't have permission to manage the team. Only owners and
        admins can invite or remove members.
      </div>
    );
  }

  if (!businessId) {
    return (
      <div style={{ fontSize: 12, color: 'var(--t3)' }}>
        Loading team…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <InviteForm businessId={businessId} businessName={brand.businessName} />
      <PendingInvitesList businessId={businessId} />
      <ActiveMembersList businessId={businessId} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Invite form
// ─────────────────────────────────────────────────────────────────────

function InviteForm({ businessId, businessName }: { businessId: string; businessName: string }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'technician'>('technician');
  const [busy, setBusy] = useState(false);
  // After a successful create, surface the magic link as a fallback —
  // useful when email sending is misconfigured or the owner just
  // wants to text it directly.
  const [lastLink, setLastLink] = useState<string | null>(null);

  const send = async () => {
    const trimmed = email.trim();
    if (!trimmed) { addToast('Email required', 'warn'); return; }
    setBusy(true);
    try {
      await createInvite({
        email: trimmed,
        businessId,
        role,
        businessName,
      });
      // Try the email send; if it fails, we still have the invite
      // doc and the magic-link fallback, so the owner can text the
      // link manually.
      const link = buildInviteLink(trimmed);
      setLastLink(link);
      try {
        await sendInviteEmail(trimmed, link);
        addToast(`Invite sent to ${trimmed}`, 'success');
      } catch (emailErr) {
        // eslint-disable-next-line no-console
        console.warn('[invites] email send failed (showing copy-link fallback):', emailErr);
        addToast('Invite created — email send failed, copy the link below to share manually', 'warn');
      }
      setEmail('');
    } catch (e) {
      addToast((e as Error).message || 'Could not create invite', 'error');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!lastLink) return;
    try {
      await navigator.clipboard.writeText(lastLink);
      addToast('Link copied', 'success');
    } catch {
      addToast('Copy failed — long-press the link to copy', 'warn');
    }
  };

  return (
    <div>
      <div style={{
        fontSize: 11, color: 'var(--t3)', fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
      }}>
        Invite a team member
      </div>

      <div className="field">
        <label>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tech@example.com"
          autoCapitalize="none"
          autoCorrect="off"
          inputMode="email"
        />
      </div>

      <div className="field">
        <label>Role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as 'admin' | 'technician')}
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--s1)', color: 'var(--t1)',
          }}
        >
          <option value="technician">Technician — log jobs, no financial access</option>
          <option value="admin">Admin — full access except billing</option>
        </select>
      </div>

      <button
        className="btn primary"
        onClick={send}
        disabled={busy || !email.trim()}
        style={{ width: '100%' }}
      >
        {busy ? 'Sending…' : 'Send invite'}
      </button>

      {lastLink && (
        <div style={{
          marginTop: 10,
          padding: 10,
          background: 'var(--s2)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 11,
          color: 'var(--t2)',
          lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 700, color: 'var(--t1)', marginBottom: 4 }}>
            Share this link directly
          </div>
          <div style={{
            wordBreak: 'break-all',
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            fontSize: 10,
            color: 'var(--t3)',
            marginBottom: 8,
          }}>
            {lastLink}
          </div>
          <button className="btn sm secondary" onClick={copyLink}>
            Copy link
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Pending invites list
// ─────────────────────────────────────────────────────────────────────

function PendingInvitesList({ businessId }: { businessId: string }) {
  const [invites, setInvites] = useState<InviteDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribePendingInvites(businessId, (list) => {
      setInvites(list);
      setLoading(false);
    });
    return () => unsub();
  }, [businessId]);

  const revoke = async (email: string) => {
    const ok = window.confirm(`Revoke invite for ${email}?`);
    if (!ok) return;
    try {
      await revokeInvite(email);
      addToast(`Invite for ${email} revoked`, 'info');
    } catch (e) {
      addToast((e as Error).message || 'Revoke failed', 'error');
    }
  };

  const copyLink = async (email: string) => {
    const link = buildInviteLink(email);
    try {
      await navigator.clipboard.writeText(link);
      addToast('Link copied', 'success');
    } catch {
      addToast('Copy failed', 'error');
    }
  };

  if (loading) {
    return (
      <div style={{ fontSize: 12, color: 'var(--t3)' }}>
        Loading invites…
      </div>
    );
  }

  return (
    <div>
      <div style={{
        fontSize: 11, color: 'var(--t3)', fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
      }}>
        Pending invites {invites.length > 0 && `(${invites.length})`}
      </div>

      {invites.length === 0 ? (
        <div style={{
          padding: 12, background: 'var(--s2)',
          border: '1px dashed var(--border2)', borderRadius: 10,
          fontSize: 12, color: 'var(--t3)', textAlign: 'center',
        }}>
          No pending invites
        </div>
      ) : (
        <div style={{
          background: 'var(--s2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          overflow: 'hidden',
        }}>
          {invites.map((inv, idx) => (
            <div
              key={inv.email}
              style={{
                padding: 10,
                borderTop: idx === 0 ? 'none' : '1px solid var(--border2)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: 'var(--t1)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {inv.email}
                </div>
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>
                  {inv.role} · invited {timeAgo(inv.invitedAt)}
                </div>
              </div>
              <button
                className="btn sm secondary"
                onClick={() => copyLink(inv.email)}
                style={{ flexShrink: 0 }}
              >
                Copy link
              </button>
              <button
                className="btn sm danger"
                onClick={() => revoke(inv.email)}
                style={{ flexShrink: 0 }}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Active members list
// ─────────────────────────────────────────────────────────────────────

function ActiveMembersList({ businessId }: { businessId: string }) {
  const [members, setMembers] = useState<MemberDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const db = getFirestore();
    const ref = collection(db, 'businesses', businessId, 'members');
    let unsub: Unsubscribe | undefined;
    try {
      unsub = onSnapshot(ref, (snap) => {
        const out: MemberDoc[] = [];
        snap.forEach((d) => {
          const data = d.data() as MemberDoc;
          // Normalize: some legacy docs only have `addedAt` not
          // `joinedAt`. Don't crash on missing fields.
          out.push({ ...data, uid: data.uid || d.id });
        });
        // Owners first, then alphabetical by email within role.
        out.sort((a, b) => {
          if (a.role === 'owner' && b.role !== 'owner') return -1;
          if (b.role === 'owner' && a.role !== 'owner') return 1;
          return (a.email || '').localeCompare(b.email || '');
        });
        setMembers(out);
        setLoading(false);
      }, (err) => {
        // eslint-disable-next-line no-console
        console.warn('[team] members listener error:', err);
        setLoading(false);
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[team] failed to attach members listener:', err);
      setLoading(false);
    }
    return () => { if (unsub) unsub(); };
  }, [businessId]);

  const remove = async (member: MemberDoc) => {
    if (member.role === 'owner') {
      addToast('Cannot remove the owner', 'warn');
      return;
    }
    if (!member.uid) {
      addToast('Member uid missing — cannot remove', 'warn');
      return;
    }
    const ok = window.confirm(`Remove ${member.email} from the team?`);
    if (!ok) return;
    try {
      const db = getFirestore();
      await deleteDoc(doc(db, 'businesses', businessId, 'members', member.uid));
      addToast(`${member.email} removed`, 'info');
    } catch (e) {
      addToast((e as Error).message || 'Remove failed', 'error');
    }
  };

  if (loading) {
    return (
      <div style={{ fontSize: 12, color: 'var(--t3)' }}>
        Loading members…
      </div>
    );
  }

  return (
    <div>
      <div style={{
        fontSize: 11, color: 'var(--t3)', fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
      }}>
        Active members ({members.length})
      </div>

      {members.length === 0 ? (
        <div style={{
          padding: 12, background: 'var(--s2)',
          border: '1px dashed var(--border2)', borderRadius: 10,
          fontSize: 12, color: 'var(--t3)', textAlign: 'center',
        }}>
          No active members
        </div>
      ) : (
        <div style={{
          background: 'var(--s2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          overflow: 'hidden',
        }}>
          {members.map((m, idx) => (
            <div
              key={m.uid || m.email}
              style={{
                padding: 10,
                borderTop: idx === 0 ? 'none' : '1px solid var(--border2)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: 'var(--t1)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {m.displayName || m.email}
                </div>
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>
                  {m.email}
                </div>
              </div>
              <RoleBadge role={m.role} />
              {m.role !== 'owner' && (
                <button
                  className="btn sm danger"
                  onClick={() => remove(m)}
                  style={{ flexShrink: 0 }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const colors: Record<Role, { bg: string; fg: string; border: string }> = {
    owner: {
      bg: 'rgba(200,164,74,.12)', fg: 'var(--brand-primary)',
      border: 'rgba(200,164,74,.35)',
    },
    admin: {
      bg: 'rgba(99,134,255,.12)', fg: 'rgb(140,165,255)',
      border: 'rgba(99,134,255,.35)',
    },
    technician: {
      bg: 'var(--s3)', fg: 'var(--t2)',
      border: 'var(--border)',
    },
  };
  const c = colors[role] || colors.technician;
  return (
    <span style={{
      fontSize: 9, fontWeight: 800,
      color: c.fg,
      textTransform: 'uppercase', letterSpacing: 1,
      padding: '3px 8px', borderRadius: 99,
      background: c.bg, border: `1px solid ${c.border}`,
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }}>
      {role}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Friendly "5 minutes ago" / "2 days ago" rendering for invite
 * timestamps. Returns "just now" for anything under a minute.
 */
function timeAgo(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(ms) || ms < 0) return 'just now';
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    return `${weeks}w ago`;
  } catch {
    return '';
  }
}

export default TeamManagement;
