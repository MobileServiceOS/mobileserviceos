// src/components/bandilero/CommandCore.tsx
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — the holographic AI Core + intelligence nodes.
//
//  The centerpiece. An arc-reactor style core (NOT a brain / face /
//  avatar): layered rotating holographic rings, a HUD tick ring, a
//  rotating radar sweep, arc-reactor spokes, expanding energy pulses,
//  dual particle belts, and an inner neural network — all wrapped in
//  volumetric halos. Surrounded by 8 intelligence nodes.
//
//  Every visual is driven by REAL data: node health = module
//  Data-Confidence, node badge = real alert count, core state = real
//  critical/alert totals, and live (CONNECTED) modules stream their
//  intelligence INTO the core along animated connectors. Nothing is
//  fabricated. Tap a node to jump to its module.
//
//  Performance: pure CSS transform/opacity animation (see bandilero.css);
//  reduced-motion disables all of it.
// ═══════════════════════════════════════════════════════════════════

import type { CoreState, CoreNode } from '@/lib/bandilero/commandCore';

const NODE_R = 42;       // node-ring radius (% of square container)
const OUTER_R = 46;      // outer particle belt radius
const INNER_R = 36;      // inner particle belt radius
const OUTER_N = 10;
const INNER_N = 8;

function polar(r: number, angleDeg: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a) };
}

const STATE_WORD: Record<CoreState, string> = { healthy: 'NOMINAL', analyzing: 'ANALYZING', alert: 'ALERTS' };
const STATE_COLOR: Record<CoreState, string> = { healthy: '#22d3ee', analyzing: '#ffcf5c', alert: '#ff6b6b' };

// Inner neural-network graph (viewBox 0..100). Kept central so the
// circular mask never clips an edge. A few edges carry animated signals.
type NN = { x: number; y: number };
const NN_NODES: NN[] = [
  { x: 50, y: 50 }, // 0 hub
  { x: 50, y: 27 }, // 1 top
  { x: 29, y: 40 }, // 2 upper-left
  { x: 71, y: 40 }, // 3 upper-right
  { x: 26, y: 63 }, // 4 lower-left
  { x: 74, y: 63 }, // 5 lower-right
  { x: 50, y: 75 }, // 6 bottom
];
const NN_EDGES: Array<[number, number, boolean]> = [
  [0, 1, true], [0, 2, false], [0, 3, true], [0, 4, false], [0, 5, false], [0, 6, true],
  [1, 2, false], [1, 3, false], [2, 4, true], [3, 5, false], [4, 6, false], [5, 6, false],
];

export function CommandCore({ state, nodes, onNodeTap }: {
  state: CoreState;
  nodes: CoreNode[];
  onNodeTap: (targetId: string) => void;
}) {
  // Node + connector geometry (start at top, 45° apart).
  const placed = nodes.slice(0, 8).map((n, i) => ({ node: n, ...polar(NODE_R, -90 + i * 45) }));
  const outer = Array.from({ length: OUTER_N }, (_, i) => polar(OUTER_R, (360 / OUTER_N) * i));
  const inner = Array.from({ length: INNER_N }, (_, i) => polar(INNER_R, (360 / INNER_N) * i + 18));

  return (
    <div className={`bnd-core-wrap ${state}`} role="img" aria-label={`Bandilero core — ${STATE_WORD[state].toLowerCase()}`}>
      {/* Intelligence connectors — live modules stream INTO the core (node → center). */}
      <svg className="bnd-core-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {placed.map(({ node, x, y }) => {
          const live = node.status === 'CONNECTED';
          const alert = node.alerts > 0;
          return (
            <line key={node.key} x1={x} y1={y} x2="50" y2="50"
              className={`bnd-connector${live ? ' active' : ''}${alert ? ' alert' : ''}`} />
          );
        })}
      </svg>

      {/* Volumetric halos (behind the core). */}
      <div className="bnd-core-halo" aria-hidden="true" />

      {/* The core */}
      <div className={`bnd-core ${state}`}>
        <div className="bnd-core-halo2" aria-hidden="true" />

        {/* Expanding energy pulses */}
        <div className="bnd-pulse-ring" aria-hidden="true" />
        <div className="bnd-pulse-ring d2" aria-hidden="true" />

        {/* Rotating holographic rings */}
        <div className="bnd-ring r1" aria-hidden="true" />
        <div className="bnd-ring r2" aria-hidden="true" />
        <div className="bnd-ring r3" aria-hidden="true" />
        <div className="bnd-ring r4" aria-hidden="true" />

        {/* HUD tick ring + radar sweep */}
        <div className="bnd-ticks" aria-hidden="true" />
        <div className="bnd-radar" aria-hidden="true" />

        {/* Dual particle belts */}
        <div className="bnd-particles" aria-hidden="true">
          {outer.map((p, i) => (
            <span key={i} className="bnd-particle" style={{ left: `${p.x}%`, top: `${p.y}%`, transform: 'translate(-50%,-50%)' }} />
          ))}
        </div>
        <div className="bnd-particles rev" aria-hidden="true">
          {inner.map((p, i) => (
            <span key={i} className="bnd-particle" style={{ left: `${p.x}%`, top: `${p.y}%`, transform: 'translate(-50%,-50%)' }} />
          ))}
        </div>

        {/* Arc-reactor spokes + bright reactor ring */}
        <div className="bnd-reactor" aria-hidden="true" />
        <div className="bnd-reactor-ring" aria-hidden="true" />

        {/* Inner neural network */}
        <div className="bnd-neural" aria-hidden="true">
          <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
            {NN_EDGES.map(([a, b, sig], i) => (
              <line key={i} x1={NN_NODES[a].x} y1={NN_NODES[a].y} x2={NN_NODES[b].x} y2={NN_NODES[b].y}
                className={`bnd-neural-edge${sig ? ' sig' : ''}`} />
            ))}
            {NN_NODES.map((n, i) => (
              <circle key={i} cx={n.x} cy={n.y} r={i === 0 ? 3 : 2}
                className="bnd-neural-node" style={{ animationDelay: `${(i * 0.34).toFixed(2)}s` }} />
            ))}
          </svg>
        </div>

        {/* Core state readout */}
        <div className="bnd-core-label">
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 2, color: '#dff7fc' }}>BANDILERO</div>
          <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 1.5, color: STATE_COLOR[state], marginTop: 1 }}>{STATE_WORD[state]}</div>
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
