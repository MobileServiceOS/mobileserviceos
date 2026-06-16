import { useMemo, useRef, useState } from 'react';
import { searchCities, titleCaseCity } from '@/lib/locations';

// ───────────────────────────────────────────────────────────────────
//  ServiceCitiesField — chip multiselect with city autocomplete.
//
//  Replaces the old plain comma-separated input. Typing suggests cities
//  for the business's state (defaults to FL); selecting or pressing Enter/
//  comma adds a chip. Manual entry always works — a city that isn't in the
//  suggestion DB (e.g. a CDP/neighborhood like "West Park" or "Brickell")
//  is still added on Enter. Each entry is title-cased and de-duplicated
//  case-insensitively on add; the Settings save path also runs
//  normalizeServiceCities for a final clean. Degrades gracefully: with no
//  state / no matches the input still accepts manual entries.
// ───────────────────────────────────────────────────────────────────

export function ServiceCitiesField({ value, onChange, state }: {
  value: string[];
  onChange: (next: string[]) => void;
  state?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateCode = (state || 'FL').toUpperCase();

  const existingLc = useMemo(() => new Set(value.map((c) => c.toLowerCase())), [value]);
  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    return searchCities(stateCode, query, 6).filter((c) => !existingLc.has(c.toLowerCase()));
  }, [stateCode, query, existingLc]);

  const addCity = (raw: string) => {
    const city = titleCaseCity(raw);
    setQuery('');
    if (!city || existingLc.has(city.toLowerCase())) return;
    onChange([...value, city]);
  };
  const removeCity = (city: string) => onChange(value.filter((c) => c !== city));

  const handleInput = (raw: string) => {
    setOpen(true);
    // Support pasting a comma-separated list — commit everything before the
    // last comma, keep the trailing fragment as the live query.
    if (raw.includes(',')) {
      const parts = raw.split(',');
      const tail = parts.pop() ?? '';
      parts.forEach((p) => { if (p.trim()) addCity(p); });
      setQuery(tail);
      return;
    }
    setQuery(raw);
  };

  return (
    <div className="field" style={{ marginTop: 14, position: 'relative' }}>
      <label htmlFor="settings-service-cities">Service cities</label>
      <div className="chip-input">
        {value.map((c) => (
          <span key={c} className="city-chip">
            {c}
            <button type="button" aria-label={`Remove ${c}`} className="city-chip-x" onClick={() => removeCity(c)}>×</button>
          </span>
        ))}
        <input
          id="settings-service-cities"
          type="text"
          value={query}
          autoComplete="off"
          placeholder={value.length ? 'Add a city…' : 'Type a city…'}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => { if (blurTimer.current) clearTimeout(blurTimer.current); setOpen(true); }}
          onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120); }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ',') && query.trim()) { e.preventDefault(); addCity(query); }
            else if (e.key === 'Backspace' && !query && value.length) { removeCity(value[value.length - 1]); }
            else if (e.key === 'Escape') { setOpen(false); }
          }}
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="city-autocomplete-menu" role="listbox">
          {suggestions.map((c) => (
            <button
              key={c}
              type="button"
              role="option"
              className="city-autocomplete-item"
              onMouseDown={(e) => { e.preventDefault(); addCity(c); }}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
        Type to search — Enter or comma adds. Cities not in the list still work.
      </div>
    </div>
  );
}
