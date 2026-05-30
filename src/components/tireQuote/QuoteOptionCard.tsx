import type { TireQuoteOption, QuoteOptionTier } from '@/lib/tireQuoteTypes';
import { money } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────
//  src/components/tireQuote/QuoteOptionCard.tsx
//
//  One card per quote tier. Role-aware: owner/admin sees supplier
//  cost + estimated profit + supplier name; tech sees only the
//  customer-facing details (brand/model/size/qty/price/ETA/notes).
//
//  Visual emphasis:
//    - BETTER tier (new midrange) gets the gold "Most Popular" badge
//    - BEST tier gets a subtle premium ring
//    - USED tiers get a distinct amber accent so they're visibly a
//      different track from the new options
// ─────────────────────────────────────────────────────────────────────

interface Props {
  option: TireQuoteOption;
  /** Whether to show wholesale cost + profit. Owner/admin only. */
  showCost: boolean;
  /** Whether this card is the selected tier (drives gold border). */
  selected: boolean;
  onSelect: () => void;
  /** Per-card action buttons. Optional — when omitted, the card is
   *  selection-only. */
  actions?: React.ReactNode;
}

const TIER_LABEL: Record<QuoteOptionTier, string> = {
  good: 'GOOD',
  better: 'BETTER',
  best: 'BEST',
  used_economy: 'USED ECONOMY',
  used_premium: 'USED PREMIUM',
};

const TIER_SUBTITLE: Record<QuoteOptionTier, string> = {
  good: 'Budget New',
  better: 'Most Popular',
  best: 'Premium New',
  used_economy: 'Quality Used',
  used_premium: 'Premium Used',
};

function isUsed(tier: QuoteOptionTier): boolean {
  return tier === 'used_economy' || tier === 'used_premium';
}

function etaLabel(etaDays: number | undefined): string {
  if (etaDays === undefined) return '';
  if (etaDays === 0) return 'Same day';
  if (etaDays === 1) return 'Next day';
  if (etaDays <= 7) return `${etaDays} days`;
  return `~${etaDays} days`;
}

export function QuoteOptionCard({ option, showCost, selected, onSelect, actions }: Props) {
  const used = isUsed(option.tier);
  const isPopular = option.tier === 'better';

  // Theme: gold for selection + new-premium; amber for used; muted for
  // unselected non-popular tiers.
  const accent = selected
    ? 'var(--brand-primary, #f4b400)'
    : isPopular
      ? 'var(--brand-primary, #f4b400)'
      : used
        ? '#f59e0b'
        : 'var(--t3)';

  const accentBg = selected
    ? 'rgba(200,164,74,0.10)'
    : isPopular
      ? 'rgba(200,164,74,0.06)'
      : used
        ? 'rgba(245,158,11,0.05)'
        : 'var(--s1)';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      style={{
        position: 'relative',
        background: accentBg,
        border: selected
          ? `2px solid ${accent}`
          : `1px solid var(--border)`,
        borderRadius: 14,
        padding: '16px 14px',
        cursor: 'pointer',
        marginBottom: 10,
      }}
    >
      {/* Popular / selected badge */}
      {isPopular && !selected && (
        <div style={{
          position: 'absolute', top: -10, right: 14,
          background: 'var(--brand-primary)', color: '#0a0a0a',
          fontSize: 10, fontWeight: 800, letterSpacing: 0.8,
          padding: '4px 10px', borderRadius: 99, textTransform: 'uppercase',
        }}>
          Most Popular
        </div>
      )}
      {selected && (
        <div style={{
          position: 'absolute', top: -10, right: 14,
          background: 'var(--brand-primary)', color: '#0a0a0a',
          fontSize: 10, fontWeight: 800, letterSpacing: 0.8,
          padding: '4px 10px', borderRadius: 99, textTransform: 'uppercase',
        }}>
          ✓ Selected
        </div>
      )}

      {/* Header: tier name + subtitle */}
      <div style={{ marginBottom: 8 }}>
        <div style={{
          fontSize: 10, fontWeight: 800, letterSpacing: 1.4,
          color: accent, textTransform: 'uppercase', marginBottom: 2,
        }}>
          {TIER_LABEL[option.tier]}
        </div>
        <div style={{ fontSize: 11, color: 'var(--t3)' }}>
          {TIER_SUBTITLE[option.tier]}
        </div>
      </div>

      {/* Customer-facing tire description */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--t1)', lineHeight: 1.2 }}>
          {option.brand} {option.model}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--t2)', marginTop: 2 }}>
          {option.tireSize} · Qty {option.quantity}
          {option.quantityAvailable !== undefined && option.quantityAvailable < option.quantity && (
            <span style={{ color: '#ef4444', marginLeft: 6, fontWeight: 600 }}>
              ⚠ {option.quantityAvailable} in stock
            </span>
          )}
        </div>
      </div>

      {/* Installed price — visual anchor */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <span style={{
          fontSize: 28, fontWeight: 800, color: accent, letterSpacing: '-0.5px', lineHeight: 1,
        }}>
          {money(option.customerPrice)}
        </span>
        <span style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 600 }}>
          installed{option.cashPrice !== undefined ? ' (card)' : ''}
        </span>
      </div>

      {option.cashPrice !== undefined && option.cashPrice !== option.customerPrice && (
        <div style={{ fontSize: 11.5, color: 'var(--t3)', marginBottom: 8 }}>
          Cash price: <strong style={{ color: 'var(--t1)' }}>{money(option.cashPrice)}</strong>
        </div>
      )}

      {/* Meta line: ETA + DOT */}
      {(option.etaDays !== undefined || option.dotDate) && (
        <div style={{
          fontSize: 11, color: 'var(--t3)', marginBottom: 6, display: 'flex', gap: 10, flexWrap: 'wrap',
        }}>
          {option.etaDays !== undefined && (
            <span>🕒 {etaLabel(option.etaDays)}</span>
          )}
          {option.dotDate && (
            <span>📅 DOT {option.dotDate}</span>
          )}
        </div>
      )}

      {option.notes && (
        <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 6, lineHeight: 1.4 }}>
          {option.notes}
        </div>
      )}

      {/* Owner/admin-only: cost + profit + supplier */}
      {showCost && (
        <div style={{
          marginTop: 10,
          padding: '8px 10px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--border2)',
          borderRadius: 8,
          fontSize: 11,
          color: 'var(--t3)',
          display: 'flex', gap: 12, flexWrap: 'wrap',
        }}>
          <span>Supplier: <strong style={{ color: 'var(--t1)' }}>{String(option.supplierName)}</strong></span>
          <span>· Cost: <strong style={{ color: 'var(--t1)' }}>{money(option.costPerTire)}/tire</strong></span>
          <span>· Profit: <strong style={{ color: option.estimatedProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {money(option.estimatedProfit)}
          </strong></span>
        </div>
      )}

      {/* Inline actions, if provided */}
      {actions && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {actions}
        </div>
      )}
    </div>
  );
}
