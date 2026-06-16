import { useEffect, useState, type ReactNode } from 'react';
import { collection, onSnapshot, deleteDoc, doc, setDoc, writeBatch, type Unsubscribe } from 'firebase/firestore';
import type { InviteDoc, MemberDoc, Role } from '@/types';
import { useBrand } from '@/context/BrandContext';
import { usePermissions } from '@/context/MembershipContext';
import { addToast } from '@/lib/toast';
import {
  createInvite,
  revokeInvite,
  subscribePendingInvites,
  buildInviteLink,
  openInviteShareSheet,
  type CreateInviteResult,
} from '@/lib/invites';
import { _auth, _db } from '@/lib/firebase';
import { canChangeRole, canRemoveMember, isLastOwner } from '@/lib/teamRoleChange';
import { ConfirmDialog } from '@/components/ConfirmDialog';

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
      <ActiveMembersList businessId={businessId} canManageOwners={permissions.canManageOwners} />
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
  // After a successful create, surface the link + a Share button so
  // the owner can text/email it via the OS share sheet. Includes the
  // full result (id/token/link) so we can reuse the same payload for
  // copy-link and share-sheet actions.
  const [lastInvite, setLastInvite] = useState<(CreateInviteResult & { email: string }) | null>(null);

  const send = async () => {
    const trimmed = email.trim();
    if (!trimmed) { addToast('Email required', 'warn'); return; }
    setBusy(true);
    try {
      const result = await createInvite({
        email: trimmed,
        businessId,
        role,
        businessName,
        invitedByDisplayName: _auth?.currentUser?.displayName || _auth?.currentUser?.email || undefined,
      });
      setLastInvite({ ...result, email: trimmed });
      addToast(`Invite created — share the link with ${trimmed}`, 'success');

      // Auto-open share sheet on mobile. If it's not available (desktop
      // browser without navigator.share), the helper falls back to a
      // clipboard copy and we toast accordingly. Wrapped in setTimeout
      // so the success toast renders first.
      setTimeout(() => { void shareLatest(result, trimmed); }, 100);

      setEmail('');
    } catch (e) {
      addToast((e as Error).message || 'Could not create invite', 'error');
    } finally {
      setBusy(false);
    }
  };

  const shareLatest = async (result: CreateInviteResult, recipientEmail: string) => {
    const ok = await openInviteShareSheet({
      businessName,
      role,
      link: result.link,
      inviterName: _auth?.currentUser?.displayName || undefined,
      email: recipientEmail,
    });
    if (!ok) addToast('Could not open share menu — use Copy link below', 'warn');
  };

  const copyLink = async () => {
    if (!lastInvite) return;
    try {
      await navigator.clipboard.writeText(lastInvite.link);
      addToast('Link copied', 'success');
    } catch {
      addToast('Copy failed — long-press the link to copy', 'warn');
    }
  };

  const shareAgain = async () => {
    if (!lastInvite) return;
    await shareLatest(lastInvite, lastInvite.email);
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

      {lastInvite && (
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
            Share this invite
          </div>
          <div style={{
            wordBreak: 'break-all',
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            fontSize: 10,
            color: 'var(--t3)',
            marginBottom: 8,
          }}>
            {lastInvite.link}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn sm primary" onClick={shareAgain} style={{ flex: 1, minWidth: 120 }}>
              Share via…
            </button>
            <button className="btn sm secondary" onClick={copyLink} style={{ flex: 1, minWidth: 100 }}>
              Copy link
            </button>
          </div>
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
  const [revoking, setRevoking] = useState<InviteDoc | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribePendingInvites(businessId, (list) => {
      setInvites(list);
      setLoading(false);
    });
    return () => unsub();
  }, [businessId]);

  const confirmRevoke = async (inv: InviteDoc) => {
    try {
      await revokeInvite(inv.token);
      addToast(`Invite for ${inv.email} revoked`, 'info');
    } catch (e) {
      addToast((e as Error).message || 'Revoke failed', 'error');
      throw e; // keep the dialog open for retry
    }
  };

  const copyLink = async (inv: InviteDoc) => {
    const link = buildInviteLink(inv.token);
    try {
      await navigator.clipboard.writeText(link);
      addToast('Link copied', 'success');
    } catch {
      addToast('Copy failed', 'error');
    }
  };

  const share = async (inv: InviteDoc) => {
    const ok = await openInviteShareSheet({
      businessName: inv.businessName,
      role: inv.role,
      link: buildInviteLink(inv.token),
      inviterName: inv.invitedByDisplayName,
      email: inv.email,
    });
    if (!ok) addToast('Share menu unavailable — link copied instead', 'info');
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
              key={inv.token || inv.email}
              style={{
                padding: 10,
                borderTop: idx === 0 ? 'none' : '1px solid var(--border2)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
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
                onClick={() => share(inv)}
                style={{ flexShrink: 0 }}
                title="Share via iMessage / Mail / etc"
              >
                Share
              </button>
              <button
                className="btn sm secondary"
                onClick={() => copyLink(inv)}
                style={{ flexShrink: 0 }}
              >
                Copy
              </button>
              <button
                className="btn sm danger"
                onClick={() => setRevoking(inv)}
                style={{ flexShrink: 0 }}
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      {revoking && (
        <ConfirmDialog
          title="Revoke invite?"
          tone="danger"
          confirmLabel="Revoke"
          busyLabel="Revoking…"
          body={<>The invite link for <strong>{revoking.email}</strong> will stop working immediately.</>}
          onConfirm={() => confirmRevoke(revoking)}
          onClose={() => setRevoking(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Transfer Ownership sub-component
// ─────────────────────────────────────────────────────────────────────

function TransferOwnership({
  members, businessId,
}: {
  members: MemberDoc[];
  businessId: string;
}) {
  const [target, setTarget] = useState('');
  const [confirming, setConfirming] = useState(false);
  const candidates = members.filter((m) => m.role !== 'owner' && m.uid);
  const targetMember = members.find((m) => m.uid === target);
  const targetName = targetMember ? (targetMember.displayName || targetMember.email) : '';

  const requestTransfer = (): void => {
    if (!target) return;
    if (!_auth?.currentUser?.uid) { addToast('Sign-in required', 'warn'); return; }
    if (!targetMember) { addToast('Target member not found', 'warn'); return; }
    setConfirming(true);
  };

  const confirmTransfer = async (): Promise<void> => {
    const actorUid = _auth?.currentUser?.uid;
    if (!actorUid || !targetMember) return;
    try {
      const db = _db; if (!db) throw new Error('Firestore not initialized');
      const batch = writeBatch(db);
      batch.set(
        doc(db, 'businesses', businessId, 'members', target),
        { ...targetMember, role: 'owner' as Role },
        { merge: true },
      );
      const actorMember = members.find((m) => m.uid === actorUid);
      if (actorMember) {
        batch.set(
          doc(db, 'businesses', businessId, 'members', actorUid),
          { ...actorMember, role: 'admin' as Role },
          { merge: true },
        );
      }
      await batch.commit();
      addToast(`Ownership transferred to ${targetName}`, 'info');
      setTarget('');
    } catch (e) {
      addToast((e as Error).message || 'Transfer failed', 'error');
      throw e; // keep the dialog open for retry
    }
  };

  return (
    <div className="team-transfer">
      <div className="team-transfer-title">Transfer ownership</div>
      <div className="team-transfer-row">
        <select
          className="team-role-select"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="">Pick a member…</option>
          {candidates.map((m) => (
            <option key={m.uid} value={m.uid}>
              {(m.displayName || m.email)} · {m.role}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn sm primary"
          disabled={!target}
          onClick={requestTransfer}
        >
          Transfer
        </button>
      </div>
      <div className="team-warning">
        You will become Admin and the selected member will become Owner.
      </div>

      {confirming && targetMember && (
        <ConfirmDialog
          title="Transfer ownership?"
          confirmLabel="Transfer ownership"
          busyLabel="Transferring…"
          body={
            <>
              <strong>{targetName}</strong> will become <strong>Owner</strong> with full
              permissions including billing and team management.
              <br /><br />
              <span style={{ color: 'var(--red)', fontWeight: 700 }}>
                You will immediately step down to Admin.
              </span>
            </>
          }
          onConfirm={confirmTransfer}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Active members list
// ─────────────────────────────────────────────────────────────────────

type PendingTeamAction =
  | { kind: 'role'; member: MemberDoc; toRole: Role; isSelf: boolean; wasOwner: boolean; becomesOwner: boolean }
  | { kind: 'remove'; member: MemberDoc; isSelf: boolean };

function ActiveMembersList({ businessId, canManageOwners }: { businessId: string; canManageOwners: boolean }) {
  const [members, setMembers] = useState<MemberDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingTeamAction | null>(null);

  useEffect(() => {
    const db = _db;
    if (!db) {
      // eslint-disable-next-line no-console
      console.warn('[team] members listener skipped — Firestore not initialized');
      setLoading(false);
      return;
    }
    if (!businessId) {
      setLoading(false);
      return;
    }
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

  const ownerCount = members.filter((m) => m.role === 'owner').length;

  // Open the confirm dialog for a role change (after permission verdict).
  const requestRoleChange = (member: MemberDoc, toRole: Role) => {
    if (!member.uid) {
      addToast('Member uid missing — cannot change role', 'warn');
      return;
    }
    const actorUid = _auth?.currentUser?.uid || '';
    const me = members.find((x) => x.uid === actorUid);
    const actorRole = (me?.role ?? 'technician') as Role;
    const verdict = canChangeRole({
      actorRole,
      targetCurrentRole: member.role,
      isSelf: member.uid === actorUid,
      isLastOwner: isLastOwner(members, member.uid),
    }, { kind: 'changeRole', toRole });
    if (!verdict.allowed) {
      addToast(verdict.reason || 'Role change not allowed', 'warn');
      return;
    }
    setPending({
      kind: 'role',
      member,
      toRole,
      isSelf: member.uid === actorUid,
      wasOwner: member.role === 'owner',
      becomesOwner: toRole === 'owner',
    });
  };

  const requestRemove = (member: MemberDoc) => {
    if (member.role === 'owner' && ownerCount <= 1) {
      addToast('Last owner — promote another member to owner first', 'warn');
      return;
    }
    if (!member.uid) {
      addToast('Member uid missing — cannot remove', 'warn');
      return;
    }
    const isSelf = !!_auth?.currentUser && member.uid === _auth.currentUser.uid;
    setPending({ kind: 'remove', member, isSelf });
  };

  const runPending = async () => {
    if (!pending) return;
    const { member } = pending;
    if (!member.uid) return;
    const db = _db; if (!db) throw new Error('Firestore not initialized');
    try {
      if (pending.kind === 'role') {
        await setDoc(doc(db, 'businesses', businessId, 'members', member.uid), { ...member, role: pending.toRole }, { merge: true });
        addToast(`${member.email} → ${pending.toRole}`, 'info');
      } else {
        await deleteDoc(doc(db, 'businesses', businessId, 'members', member.uid));
        addToast(`${member.email} removed`, 'info');
      }
    } catch (e) {
      addToast((e as Error).message || (pending.kind === 'role' ? 'Role change failed' : 'Remove failed'), 'error');
      throw e; // keep the dialog open for retry
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
      {canManageOwners && members.filter((m) => m.role !== 'owner').length > 0 && (
        <TransferOwnership members={members} businessId={businessId} />
      )}

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
          {members.map((m) => {
            const actorUid = _auth?.currentUser?.uid;
            const isSelf = !!actorUid && m.uid === actorUid;
            const actorRole = (() => {
              if (!actorUid) return 'technician' as const;
              const me = members.find((x) => x.uid === actorUid);
              return (me?.role ?? 'technician') as Role;
            })();
            const lastOwner = m.uid ? isLastOwner(members, m.uid) : false;

            // Build the dropdown options + per-option allow verdict
            // so the UI can disable forbidden transitions.
            const roleOptions: Role[] = ['owner', 'admin', 'technician'];
            const optionVerdict = (toRole: Role) => canChangeRole({
              actorRole, targetCurrentRole: m.role, isSelf, isLastOwner: lastOwner,
            }, { kind: 'changeRole', toRole });
            const anyChangeAllowed = roleOptions.some((r) => r !== m.role && optionVerdict(r).allowed);
            const removeVerdict = canRemoveMember({
              actorRole, targetCurrentRole: m.role, isSelf, isLastOwner: lastOwner,
            });

            return (
              <div key={m.uid || m.email} className={'team-member-row' + (isSelf ? ' self' : '')}>
                <div className="team-member-row-head">
                  <div className="team-member-row-info">
                    <div className="team-member-row-name">
                      {m.displayName || m.email}
                      {isSelf && <span className="self-tag">(you)</span>}
                    </div>
                    <div className="team-member-row-email">{m.email}</div>
                  </div>
                  <RoleBadge role={m.role} />
                </div>
                <div className="team-member-row-controls">
                  <select
                    className="team-role-select"
                    aria-label={`Role for ${m.email}`}
                    value={m.role}
                    disabled={!anyChangeAllowed}
                    onChange={(e) => requestRoleChange(m, e.target.value as Role)}
                  >
                    {roleOptions.map((r) => {
                      const v = r === m.role ? { allowed: true } : optionVerdict(r);
                      const label = r.charAt(0).toUpperCase() + r.slice(1);
                      return (
                        <option key={r} value={r} disabled={!v.allowed}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                  <button
                    className="btn sm danger"
                    onClick={() => requestRemove(m)}
                    disabled={!removeVerdict.allowed}
                    title={removeVerdict.allowed ? undefined : removeVerdict.reason}
                    style={{ flexShrink: 0 }}
                  >
                    Remove
                  </button>
                </div>
                {!anyChangeAllowed && actorRole !== 'technician' && (
                  <div className="team-warning" title={lastOwner ? 'Last owner — promote another member to owner first' : undefined}>
                    {lastOwner ? '⚠ Last owner — no role change possible' : '⚠ No allowed role change'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pending && (() => {
        const m = pending.member;
        const who = <strong>{m.displayName || m.email}</strong>;
        const selfWarn = (text: string): ReactNode => (
          <><br /><br /><span style={{ color: 'var(--red)', fontWeight: 700 }}>{text}</span></>
        );
        let title: string;
        let body: ReactNode;
        let confirmLabel: string;
        let busyLabel: string;
        let tone: 'danger' | 'primary';
        if (pending.kind === 'role' && pending.becomesOwner) {
          title = 'Promote to Owner?';
          body = <>{who} will get full permissions, including billing and team management.</>;
          confirmLabel = 'Promote to Owner'; busyLabel = 'Promoting…'; tone = 'primary';
        } else if (pending.kind === 'role' && pending.wasOwner) {
          title = 'Demote owner?';
          body = <>{who} will lose owner permissions.{pending.isSelf && selfWarn('You will lose your owner permissions immediately.')}</>;
          confirmLabel = `Demote to ${pending.toRole}`; busyLabel = 'Saving…'; tone = 'danger';
        } else if (pending.kind === 'role') {
          title = 'Change role?';
          body = <>Set {who} to <strong>{pending.toRole}</strong>.</>;
          confirmLabel = `Set to ${pending.toRole}`; busyLabel = 'Saving…'; tone = 'primary';
        } else {
          const ownerRemoval = m.role === 'owner';
          title = ownerRemoval ? 'Remove owner?' : 'Remove member?';
          body = (
            <>
              {ownerRemoval
                ? <>{who} will immediately lose access to this business.</>
                : <>Remove {who} from the team?</>}
              {pending.isSelf && selfWarn('You will be signed out of this business.')}
            </>
          );
          confirmLabel = 'Remove'; busyLabel = 'Removing…'; tone = 'danger';
        }
        return (
          <ConfirmDialog
            title={title}
            body={body}
            confirmLabel={confirmLabel}
            busyLabel={busyLabel}
            tone={tone}
            onConfirm={runPending}
            onClose={() => setPending(null)}
          />
        );
      })()}
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
