// src/components/bandilero/CommandConsole.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — AI command console (Jarvis-style).
//
//  A persistent prompt that answers from REAL deterministic service
//  outputs (commandConsole.answerQuery). Never invents — unknown queries
//  return guidance, NOT_CONNECTED data is surfaced honestly, and
//  financial answers are redacted for technicians by the router.
// ═══════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { answerQuery, EXAMPLE_QUERIES, type ConsoleContext, type ConsoleAnswer } from '@/lib/bandilero/commandConsole';

const CONF_COLOR: Record<string, string> = { LIVE: '#22d3ee', ESTIMATED: '#ffcf5c', NOT_CONNECTED: '#6b7280' };

export function CommandConsole({ ctx }: { ctx: ConsoleContext }) {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<ConsoleAnswer | null>(null);

  const run = (q: string) => {
    const text = q.trim();
    setQuery(text);
    setAnswer(answerQuery(text, ctx));
  };

  return (
    <div className="bnd-card bnd-glass" style={{ padding: '13px 14px', marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span aria-hidden="true" style={{ color: 'var(--bnd-cyan,#22d3ee)', fontWeight: 800, fontSize: 16, textShadow: '0 0 10px rgba(34,211,238,0.6)' }}>›</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(query); }}
          placeholder="Ask Bandilero…"
          aria-label="Ask Bandilero a question"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: '#eef3fb', fontSize: 13.5, fontWeight: 500, letterSpacing: 0.2,
          }}
        />
        <button type="button" onClick={() => run(query)} aria-label="Ask"
          style={{
            border: '1px solid rgba(34,211,238,0.3)', background: 'rgba(34,211,238,0.1)',
            color: '#9bf0fb', borderRadius: 9, padding: '5px 11px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer',
          }}>Ask</button>
      </div>

      {/* Answer */}
      {answer && (
        <div style={{ marginTop: 11, paddingTop: 11, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: answer.matched ? '#dff2f7' : '#9aa3b2' }}>{answer.text}</div>
          {answer.matched && answer.source && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, color: '#7e8798', textTransform: 'uppercase' }}>Source: {answer.source}</span>
              {answer.confidence && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: CONF_COLOR[answer.confidence], textTransform: 'uppercase' }}>
                  <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, background: CONF_COLOR[answer.confidence] }} />
                  {answer.confidence.replace('_', ' ')}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Example chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 11 }}>
        {EXAMPLE_QUERIES.map((q) => (
          <button key={q} type="button" onClick={() => run(q)}
            style={{
              border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)',
              color: '#9aa3b2', borderRadius: 999, padding: '4px 10px', fontSize: 10.5, cursor: 'pointer', whiteSpace: 'nowrap',
            }}>{q}</button>
        ))}
      </div>
    </div>
  );
}
