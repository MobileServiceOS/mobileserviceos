// src/components/bandilero/CommandCore.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — the holographic AI Core + intelligence nodes (Phase B).
//
//  The centerpiece. A layered, rotating holographic core (NOT a brain /
//  face / avatar) surrounded by 8 intelligence nodes. Every visual is
//  driven by REAL data — node health = module Data-Confidence, node
//  badge = real alert count, core state = real critical/alert totals.
//  Nothing is fabricated. Tap a node to jump to its module.
//
//  Performance: pure CSS transform/opacity animation (see bandilero.css),
//  ≤10 particles, one blur layer, reduced-motion disables all of it.
// ═══════════════════════════════════════════════════════════════════

import type { CoreState, CoreNode } from '@/lib/bandilero/commandCore';

const NODE_R = 42;       // node-ring radius (% of square container)
const PARTICLE_R = 46;   // particle radius (% of particle box)
const PARTICLES = 10;

function polar(r: number, angleDeg: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) };
}

const STATE_WORD: Record<CoreState, string> = { healthy: 'NOMINAL', analyzing: 'ANALYZING', alert: 'ALERTS' };
const STATE_COLOR: Record<CoreState, string> = { healthy: '#22d3ee', analyzing: '#ffcf5c', alert: '#ff6b6b' };

export function CommandCore({ state, nodes, onNodeTap }: {
  state: CoreState;
  nodes: CoreNode[];
  onNodeTap: (targetId: string) => void;
}) {
  // Node + connector geometry (start at top, 45° apart).
  const placed = nodes.slice(0, 8).map((n, i) => ({ node: n, ...polar(NODE_R, -90 + i * 45) }));
  const particles = Array.from({ length: PARTICLES }, (_, i) => polar(PARTICLE_R, (360 / PARTICLES) * i));

  return (
    <div className="bnd-core-wrap" role="img" aria-label={`Bandilero core — ${STATE_WORD[state].toLowerCase()}`}>
      {/* Connectors (behind nodes) */}
      <svg className="bnd-core-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {placed.map(({ node, x, y }) => {
          const live = node.status === 'CONNECTED';
          const alert = node.alerts > 0;
          return (
            <line key={node.key} x1="50" y1="50" x2={x} y2={y}
              className={`bnd-connector${live ? ' active' : ''}${alert ? ' alert' : ''}`} />
          );
        })}
      </svg>

      {/* The core */}
      <div className={`bnd-core ${state}`}>
        <div className="bnd-ring r1" />
        <div className="bnd-ring r2" />
        <div className="bnd-ring r3" />
        <div className="bnd-particles" aria-hidden="true">
          {particles.map((p, i) => (
            <span key={i} className="bnd-particle" style={{ left: `${p.x}%`, top: `${p.y}%`, transform: 'translate(-50%,-50%)' }} />
          ))}
        </div>
        <div className="bnd-core-glow" aria-hidden="true" />
        <div className="bnd-core-label">
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: '#dff7fc' }}>BANDILERO</div>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color: STATE_COLOR[state], marginTop: 2 }}>{STATE_WORD[state]}</div>
        </div>
      </div>

      {/* Nodes */}
      {placed.map(({ node, x, y }) => {
        const cls = node.status === 'CONNECTED' ? 'on' : node.status === 'PARTIAL' ? 'partial' : '';
        return (
          <button key={node.key} type="button" className={`bnd-node ${cls}`}
            style={{ left: `${x}%`, top: `${y}%` }}
            onClick={() => onNodeTap(node.targetId)}
            aria-label={`${node.label}: ${node.status.toLowerCase().replace('_', ' ')}${node.alerts > 0 ? `, ${node.alerts} alert${node.alerts === 1 ? '' : 's'}` : ''}`}>
            <span className="bnd-node-disc">
              <span aria-hidden="true" style={{ fontSize: 15, opacity: node.status === 'NOT_CONNECTED' ? 0.4 : 1 }}>{node.icon}</span>
              {node.alerts > 0 && <span className="bnd-node-badge">{node.alerts}</span>}
            </span>
            <span className="bnd-node-label">{node.label}</span>
          </button>
        );
      })}
    </div>
  );
}
