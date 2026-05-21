// src/config/notifications/templates.ts
// ═══════════════════════════════════════════════════════════════════
//  Static template registry — one entry per templateId referenced in
//  universal-stages StageNotificationSpec declarations. Each template
//  declares channel + body (+ optional subject for email). Variables
//  in {curly.braces} resolve via renderTemplate().
//
//  Adding a new template means adding an entry here AND referencing
//  the templateId in a stage's notifications array (or in a
//  vertical's stageOverrides). Missing templates log a console.warn
//  and skip — never crash the transition write.
// ═══════════════════════════════════════════════════════════════════

export interface NotificationTemplate {
  id: string;
  channel: 'sms' | 'email' | 'in_app';
  subject?: string;
  body: string;
  description?: string;
}

export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  tech_assigned: {
    id: 'tech_assigned',
    channel: 'in_app',
    body: '{tech.name} assigned to job #{job.shortId} for {customer.name}',
    description: 'Fires when a job moves into dispatched — owner audience.',
  },
  tech_on_the_way: {
    id: 'tech_on_the_way',
    channel: 'sms',
    body: "Hi {customer.firstName}, this is {business.name}. I'm on my way for your {job.service}. Reply STOP to opt out.",
    description: 'Customer SMS when job moves into enroute.',
  },
  tech_arrived: {
    id: 'tech_arrived',
    channel: 'sms',
    body: 'Hi {customer.firstName}, I just arrived for your {job.service}. - {business.name}',
    description: 'Customer SMS when tech marks onsite.',
  },
  job_done: {
    id: 'job_done',
    channel: 'in_app',
    body: '{tech.name} completed job #{job.shortId} ({customer.name})',
    description: 'Owner in-app when a job moves into completed.',
  },
  invoice_sent: {
    id: 'invoice_sent',
    channel: 'email',
    subject: 'Invoice for your {job.service} - {business.name}',
    body: 'Hi {customer.firstName},\n\nThank you for choosing {business.name}. Your invoice for {job.service} totaling {job.totalFormatted} is attached.\n\nPayment options: {business.paymentMethods}\n\nQuestions? Reply to this email or call {business.phone}.\n\n- {business.name}',
    description: 'Customer email when job moves into invoiced.',
  },
  thank_you_review_request: {
    id: 'thank_you_review_request',
    channel: 'sms',
    body: 'Thank you for choosing {business.name}, {customer.firstName}! If we earned 5 stars, a quick review would mean the world: {business.reviewUrl}',
    description: 'Customer SMS on first entry to paid — review prompt.',
  },
  payment_received: {
    id: 'payment_received',
    channel: 'in_app',
    body: 'Payment received: {job.totalFormatted} from {customer.name} (job #{job.shortId})',
    description: 'Owner in-app on every entry to paid.',
  },
};
