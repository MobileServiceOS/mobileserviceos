// src/config/jobs/universal-stages.ts
// ═══════════════════════════════════════════════════════════════════
//  The 13 universal job-lifecycle stages with their default specs.
//  Per-vertical overrides live on BusinessTypeConfig.lifecycle.
//  stageOverrides; the resolver merges this baseline + the override.
//
//  Adding a 14th universal stage means appending one entry here AND
//  one literal to the JobLifecycleStage union in lifecycle.ts.
//  Every vertical automatically inherits the new stage.
//
//  Notification baseline rationale (see spec §10): platform-wide
//  customer-facing notifications (tech-on-the-way, invoice sent,
//  thank-you) and owner-facing operational ones (technician assigned,
//  job done, payment received) live here. Verticals can replace any
//  stage's notifications array via stageOverrides; an empty array is
//  the explicit "suppress all on this stage" signal.
// ═══════════════════════════════════════════════════════════════════

import type { StageSpec } from './lifecycle';

export const UNIVERSAL_STAGES: ReadonlyArray<StageSpec> = [
  {
    id: 'lead',
    label: 'Lead',
    tone: 'neutral',
    technicianVisible: false,
    customerVisible: false,
    recommendedNext: ['quoted', 'scheduled', 'canceled'],
    category: 'pre_service',
  },
  {
    id: 'quoted',
    label: 'Quoted',
    tone: 'info',
    technicianVisible: false,
    customerVisible: true,
    recommendedNext: ['scheduled', 'canceled'],
    category: 'pre_service',
  },
  {
    id: 'scheduled',
    label: 'Scheduled',
    tone: 'info',
    technicianVisible: true,
    customerVisible: true,
    recommendedNext: ['dispatched', 'canceled'],
    category: 'pre_service',
  },
  {
    id: 'dispatched',
    label: 'Dispatched',
    tone: 'info',
    technicianVisible: true,
    customerVisible: false,
    recommendedNext: ['enroute', 'canceled'],
    category: 'in_field',
    notifications: [
      { audience: 'owner', channel: 'in_app', templateId: 'tech_assigned', fireMode: 'first_entry' },
    ],
  },
  {
    id: 'enroute',
    label: 'En route',
    shortLabel: 'En route',
    tone: 'info',
    technicianVisible: true,
    customerVisible: true,
    recommendedNext: ['onsite', 'canceled'],
    category: 'in_field',
    notifications: [
      { audience: 'customer', channel: 'sms', templateId: 'tech_on_the_way', fireMode: 'every_entry' },
    ],
  },
  {
    id: 'onsite',
    label: 'On-site',
    shortLabel: 'On-site',
    tone: 'info',
    technicianVisible: true,
    customerVisible: true,
    recommendedNext: ['in_progress', 'canceled'],
    category: 'in_field',
    notifications: [
      { audience: 'customer', channel: 'sms', templateId: 'tech_arrived', fireMode: 'every_entry' },
    ],
  },
  {
    id: 'in_progress',
    label: 'In progress',
    shortLabel: 'Working',
    tone: 'warning',
    technicianVisible: true,
    customerVisible: true,
    recommendedNext: ['waiting_parts', 'awaiting_approval', 'completed', 'canceled'],
    category: 'in_field',
  },
  {
    id: 'waiting_parts',
    label: 'Waiting on parts',
    shortLabel: 'Parts',
    tone: 'warning',
    technicianVisible: true,
    customerVisible: true,
    recommendedNext: ['in_progress', 'canceled'],
    category: 'in_field',
  },
  {
    id: 'awaiting_approval',
    label: 'Awaiting approval',
    shortLabel: 'Approval',
    tone: 'warning',
    technicianVisible: true,
    customerVisible: true,
    recommendedNext: ['in_progress', 'canceled'],
    category: 'in_field',
  },
  {
    id: 'completed',
    label: 'Completed',
    shortLabel: 'Done',
    tone: 'success',
    technicianVisible: true,
    customerVisible: true,
    recommendedNext: ['invoiced', 'paid'],
    category: 'post_service',
    notifications: [
      { audience: 'owner', channel: 'in_app', templateId: 'job_done', fireMode: 'first_entry' },
    ],
  },
  {
    id: 'invoiced',
    label: 'Invoiced',
    tone: 'success',
    technicianVisible: false,
    customerVisible: true,
    recommendedNext: ['paid'],
    category: 'post_service',
    notifications: [
      { audience: 'customer', channel: 'email', templateId: 'invoice_sent', fireMode: 'every_entry' },
    ],
  },
  {
    id: 'paid',
    label: 'Paid',
    tone: 'success',
    technicianVisible: false,
    customerVisible: true,
    recommendedNext: [],
    category: 'terminal',
    notifications: [
      { audience: 'customer', channel: 'sms', templateId: 'thank_you_review_request', fireMode: 'first_entry' },
      { audience: 'owner', channel: 'in_app', templateId: 'payment_received', fireMode: 'every_entry' },
    ],
  },
  {
    id: 'canceled',
    label: 'Canceled',
    tone: 'danger',
    technicianVisible: true,
    customerVisible: true,
    recommendedNext: [],
    category: 'terminal',
  },
];
