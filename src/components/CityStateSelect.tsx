import { useEffect, useMemo, useRef, useState } from 'react';
import { US_STATES, searchCities, fullLocationLabel } from '@/lib/locations';

interface Props {
  city: string;
  state: string;
  onChange: (next: { city: string; state: string; fullLocationLabel: string }) => void;
  cityLabel?: string;
  stateLabel?: string;
  cityPlaceholder?: string;
  required?: boolean;
}

export function CityStateSelect({
  city,
  state,
  onChange,
  cityLabel = 'City',
  stateLabel = 'State',
  cityPlaceholder = 'Start typing your city',
  required,
}: Props) {
  const [query, setQuery] = useState(city || '');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Keep input in sync if parent updates city externally (e.g., reset).
  useEffect(() => {
    setQuery(city || '');
  }, [city]);

  const suggestions = useMemo(() => searchCities(state, query, 8), [state, query]);

  // Close on outside click / escape.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const commit = (nextCity: string, nextState: string = state) => {
    setQuery(nextCity);
    setOpen(false);
    onChange({
      city: nextCity,
      state: nextState,
      fullLocationLabel: fullLocationLabel(nextCity, nextState),
    });
  };

  return (
    <div className="field-row" style={{ position: 'relative' }}>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>
          {stateLabel}
          {required ? <span style={{ color: 'var(--brand-primary)' }}> *</span> : null}
        </label>
        <select
          value={state}
          onChange={(e) => {
            const nextState = e.target.value;
            commit(query, nextState);
          }}
        >
          <option value="">Select…</option>
          {US_STATES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field city-autocomplete" ref={wrapRef} style={{ marginBottom: 0, position: 'relative' }}>
        <label>
          {cityLabel}
          {required ? <span style={{ color: 'var(--brand-primary)' }}> *</span> : null}
        </label>
        <input
          type="text"
          value={query}
          placeholder={cityPlaceholder}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIdx(0);
            setOpen(true);
            // Live-commit free-text so parent stays in sync even without selection.
            onChange({
              city: e.target.value,
              state,
              fullLocationLabel: fullLocationLabel(e.target.value, state),
            });
          }}
          onKeyDown={(e) => {
            if (!open || !suggestions.length) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIdx((i) => Math.min(suggestions.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              commit(suggestions[activeIdx]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {open && state && suggestions.length > 0 && (
          <div className="city-autocomplete-menu" role="listbox">
            {suggestions.map((c, i) => (
              <button
                key={c}
                type="button"
                role="option"
                aria-selected={i === activeIdx}
                className={'city-autocomplete-item' + (i === activeIdx ? ' active' : '')}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(c);
                }}
              >
                {c}
              </button>
            ))}
            {query.trim() && !suggestions.some((c) => c.toLowerCase() === query.trim().toLowerCase()) && (
              <button
                type="button"
                className="city-autocomplete-item custom"
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(query.trim());
                }}
              >
                Use “{query.trim()}”
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
