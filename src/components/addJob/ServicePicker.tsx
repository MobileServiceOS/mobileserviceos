// src/components/ServicePicker.tsx
// ═══════════════════════════════════════════════════════════════════
//  Service selector for AddJob. Two modes, chosen automatically from
//  the active vertical's runtime config — no hardcoded service lists:
//
//   • FLAT  — vertical's services declare no `category`. Renders the
//             original chip-grid with service icons. Used by tire
//             (short list) and detailing packages.
//
//   • GROUPED — at least one service declares a `category`. Renders a
//             compact "Popular" row + a search box + collapsible
//             category sections. Used by mechanic (22 services that
//             were a crowded single chip wall). Categories start
//             collapsed; the one holding the current selection
//             auto-expands so the operator never loses sight of it.
//
//  UI/UX only — selection still flows through the same onSelect →
//  job.service path. No pricing / save / Firestore changes.
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import type { BusinessTypeService } from '@/config/businessTypes/registry';
import { serviceIcon } from '@/lib/utils';

interface Props {
  /** The active vertical's full service catalog (vertical.services). */
  services: ReadonlyArray<BusinessTypeService>;
  /** Service ids currently enabled for this business (operator may
   *  have disabled some in Settings → Pricing). */
  enabledIds: ReadonlyArray<string>;
  /** Currently selected service id (job.service). */
  selected: string;
  /** Fires with the chosen service id. */
  onSelect: (id: string) => void;
}

export function ServicePicker({ services, enabledIds, selected, onSelect }: Props) {
  // Resolve the enabled subset, preserving config order.
  const available = useMemo(() => {
    const enabled = new Set(enabledIds);
    return services.filter((s) => enabled.has(s.id));
  }, [services, enabledIds]);

  const grouped = useMemo(
    () => available.some((s) => !!s.category),
    [available],
  );

  if (!grouped) {
    return <FlatPicker available={available} selected={selected} onSelect={onSelect} />;
  }
  return <GroupedPicker available={available} selected={selected} onSelect={onSelect} />;
}

// ─── Flat mode — tire / detailing ──────────────────────────────────
function FlatPicker({
  available, selected, onSelect,
}: { available: ReadonlyArray<BusinessTypeService>; selected: string; onSelect: (id: string) => void }) {
  return (
    <div className="chip-grid">
      {available.map((s) => (
        <button
          key={s.id}
          type="button"
          className={'chip' + (selected === s.id ? ' active' : '')}
          onClick={() => onSelect(s.id)}
        >
          <span style={{ marginRight: 6 }}>{serviceIcon(s.id)}</span>{s.label}
        </button>
      ))}
    </div>
  );
}

// ─── Grouped mode — mechanic ───────────────────────────────────────
function GroupedPicker({
  available, selected, onSelect,
}: { available: ReadonlyArray<BusinessTypeService>; selected: string; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('');

  // Category order = first-seen order in the config array.
  const categoryOrder = useMemo(() => {
    const seen: string[] = [];
    for (const s of available) {
      const c = s.category || 'General / Other';
      if (!seen.includes(c)) seen.push(c);
    }
    return seen;
  }, [available]);

  const byCategory = useMemo(() => {
    const map = new Map<string, BusinessTypeService[]>();
    for (const s of available) {
      const c = s.category || 'General / Other';
      const arr = map.get(c) || [];
      arr.push(s);
      map.set(c, arr);
    }
    return map;
  }, [available]);

  const popular = useMemo(
    () => available.filter((s) => s.popular),
    [available],
  );

  // Auto-expand the category containing the current selection so the
  // operator can see it without hunting. Re-derived only on mount /
  // selection change via the initializer + the `selectedCategory` dep.
  const selectedCategory = useMemo(
    () => available.find((s) => s.id === selected)?.category || null,
    [available, selected],
  );
  const [open, setOpen] = useState<Set<string>>(() =>
    selectedCategory ? new Set([selectedCategory]) : new Set(),
  );
  const toggle = (cat: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  // Search results — flat, case-insensitive label match. When the
  // query is non-empty the category structure is replaced by a
  // single result list so the operator sees everything at once.
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return available.filter((s) => s.label.toLowerCase().includes(q));
  }, [query, available]);

  return (
    <div className="svc-picker">
      <input
        className="svc-search"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search services…"
        aria-label="Search services"
      />

      {searchResults ? (
        <div className="svc-results">
          {searchResults.length === 0 ? (
            <div className="svc-empty">No services match “{query.trim()}”.</div>
          ) : (
            <div className="svc-chip-row">
              {searchResults.map((s) => (
                <ServiceChip
                  key={s.id}
                  service={s}
                  selected={selected === s.id}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {popular.length > 0 && (
            <div className="svc-section">
              <div className="svc-section-label">Popular</div>
              <div className="svc-chip-row">
                {popular.map((s) => (
                  <ServiceChip
                    key={s.id}
                    service={s}
                    selected={selected === s.id}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </div>
          )}

          {categoryOrder.map((cat) => {
            const items = byCategory.get(cat) || [];
            if (items.length === 0) return null;
            const isOpen = open.has(cat);
            const hasSelection = items.some((s) => s.id === selected);
            return (
              <div className="svc-cat" key={cat}>
                <button
                  type="button"
                  className={'svc-cat-head' + (isOpen ? ' open' : '')}
                  onClick={() => toggle(cat)}
                  aria-expanded={isOpen}
                >
                  <span className="svc-cat-name">
                    {cat}
                    {hasSelection && !isOpen && <span className="svc-cat-dot" aria-hidden />}
                  </span>
                  <span className="svc-cat-meta">
                    <span className="svc-cat-count">{items.length}</span>
                    <span className={'svc-cat-caret' + (isOpen ? ' open' : '')} aria-hidden>›</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="svc-chip-row svc-cat-body">
                    {items.map((s) => (
                      <ServiceChip
                        key={s.id}
                        service={s}
                        selected={selected === s.id}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function ServiceChip({
  service, selected, onSelect,
}: { service: BusinessTypeService; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      className={'svc-chip' + (selected ? ' selected' : '')}
      onClick={() => onSelect(service.id)}
      aria-pressed={selected}
    >
      {selected && <span className="svc-chip-check" aria-hidden>✓</span>}
      {service.label}
    </button>
  );
}
