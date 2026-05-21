// src/lib/notificationDispatch.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure notification dispatcher — reads the just-appended transition,
//  consults the stage's notifications[] spec, applies fireMode rules,
//  renders templates, and returns NotificationDocs to write.
//
//  Returns two arrays: `inAppDocs` (audience: owner/tech, channel:
//  in_app) and `pendingActions` (audience: customer, channel:
//  sms/email). The caller writes ALL of them to Firestore — the
//  split is informational for surfacing pending tap-to-send actions.
// ═══════════════════════════════════════════════════════════════════

import type { Job, NotificationDoc } from '@/types';
import type { LifecycleTransition, ResolvedLifecycle } from '@/config/jobs/lifecycle';
import { uid } from '@/lib/utils';
import { NOTIFICATION_TEMPLATES } from '@/config/notifications/templates';
import { renderTemplate, type TemplateVars } from '@/lib/notificationTemplates';

export interface DispatchContext {
  transition: LifecycleTransition;
  job: Job;
  prior_transitions: ReadonlyArray<LifecycleTransition>;
  resolved: ResolvedLifecycle;
  vars: TemplateVars;
  businessId: string;
  byUid: string;
  ownerUids: ReadonlyArray<string>;
  assignedToUid?: string;
}

export function dispatchNotifications(ctx: DispatchContext): {
  inAppDocs: NotificationDoc[];
  pendingActions: NotificationDoc[];
} {
  const stage = ctx.resolved.stageById.get(ctx.transition.toStage);
  if (!stage || !stage.notifications || stage.notifications.length === 0) {
    return { inAppDocs: [], pendingActions: [] };
  }

  const inAppDocs: NotificationDoc[] = [];
  const pendingActions: NotificationDoc[] = [];
  const now = new Date().toISOString();

  const priorEntryToStage = ctx.prior_transitions.some(
    (t) => t.toStage === ctx.transition.toStage,
  );

  for (const spec of stage.notifications) {
    if (spec.fireMode === 'first_entry' && priorEntryToStage) continue;

    const template = NOTIFICATION_TEMPLATES[spec.templateId];
    if (!template) {
      // eslint-disable-next-line no-console
      console.warn(`[notifications] missing template "${spec.templateId}" — skipping`);
      continue;
    }

    const { subject, body } = renderTemplate(template, ctx.vars);

    const baseDoc: NotificationDoc = {
      id: uid(),
      createdAt: now,
      jobId: ctx.job.id,
      audience: spec.audience,
      channel: spec.channel,
      templateId: spec.templateId,
      subject,
      body,
      byUid: ctx.byUid,
      toStage: ctx.transition.toStage,
    };

    if (spec.audience === 'technician' && ctx.assignedToUid) {
      baseDoc.toUid = ctx.assignedToUid;
    } else if (spec.audience === 'customer') {
      if (spec.channel === 'sms') baseDoc.toPhone = ctx.vars.customer.phone;
      if (spec.channel === 'email') baseDoc.toEmail = ctx.vars.customer.email;
    }

    if (spec.channel === 'in_app') {
      inAppDocs.push(baseDoc);
    } else if (spec.audience === 'customer' && (spec.channel === 'sms' || spec.channel === 'email')) {
      pendingActions.push(baseDoc);
    } else {
      // Owner/technician audience with non-in_app channel — degrade to
      // in_app (no auto-push without backend).
      inAppDocs.push({ ...baseDoc, channel: 'in_app' });
    }
  }

  return { inAppDocs, pendingActions };
}
