// src/lib/ops/loops/review.ts
// ═══════════════════════════════════════════════════════════════════
//  Loop 2 — Review-reply autodraft (DRAFT ONLY, never auto-post).
//
//  Given a Google review, draft a reply in the house style. The output
//  is a DRAFT the owner edits and sends; the SEND is a gated,
//  side-effecting action (see registry.ts → review.send). We NEVER
//  auto-post.
//
//  House-style rules live in ../houseStyle.ts and are both (a) injected
//  into the prompt and (b) validated on the returned draft so the UI can
//  flag any slip for the owner before they use it.
// ═══════════════════════════════════════════════════════════════════

import { safeParseJson, asString, type ParseResult } from '@/lib/ops/json';
import { REQUIRED_PHRASE, REQUIRED_COUNTIES } from '@/lib/ops/houseStyle';

export interface ReviewInput {
  /** The customer's review text. */
  text: string;
  /** Reviewer display name, if known. */
  reviewerName?: string;
  /** Star rating 1–5, if known. */
  rating?: number;
}

export interface ReviewContext {
  businessName: string;
  requiredPhrase: string;
  counties: string[];
  review: ReviewInput;
}

export interface ReviewDraft {
  reply: string;
}

/** Assemble the review context from the pasted review + brand. */
export function gatherReviewContext(review: ReviewInput, businessName: string): ReviewContext {
  return {
    businessName: businessName || 'our shop',
    requiredPhrase: REQUIRED_PHRASE,
    counties: [...REQUIRED_COUNTIES],
    review: {
      text: (review.text ?? '').trim(),
      reviewerName: review.reviewerName?.trim() || undefined,
      rating: typeof review.rating === 'number' ? review.rating : undefined,
    },
  };
}

/** Build the JSON-only prompt with the strict house style baked in. */
export function buildReviewPrompt(ctx: ReviewContext): { system: string; user: string } {
  const system = [
    `You are the owner of ${ctx.businessName}, a ${ctx.requiredPhrase} serving ${ctx.counties.join(' and ')} counties in Florida.`,
    `Write a reply to a Google review.`,
    ``,
    `Return ONLY a JSON object, no prose, no code fences, in exactly this shape:`,
    `{"reply":"<the reply text>"}`,
    ``,
    `The reply MUST follow ALL of these rules, strictly:`,
    `- Warm, professional, and specific to what the review actually said.`,
    `- NO emoji of any kind.`,
    `- NO dashes of any kind: no hyphens "-", no en dashes, no em dashes. Rephrase to avoid them entirely (write "Miami Dade", never "Miami-Dade").`,
    `- Include the exact phrase "${ctx.requiredPhrase}".`,
    `- Reference both ${ctx.counties[0]} and ${ctx.counties[1]}.`,
    `- Keep it concise (2 to 4 sentences). Do not invent details the review did not mention.`,
    `Output nothing except the JSON object.`,
  ].join('\n');

  const user = JSON.stringify(
    {
      reviewerName: ctx.review.reviewerName ?? null,
      rating: ctx.review.rating ?? null,
      review: ctx.review.text,
    },
    null,
    2,
  );
  return { system, user };
}

/** Safely parse + validate the model's review draft. */
export function parseReviewResult(raw: string): ParseResult<ReviewDraft> {
  const parsed = safeParseJson<unknown>(raw);
  if (!parsed.ok) return parsed;

  const root = parsed.value as { reply?: unknown };
  const reply = asString(root?.reply);
  if (!reply) return { ok: false, error: 'missing "reply" string' };
  return { ok: true, value: { reply } };
}
