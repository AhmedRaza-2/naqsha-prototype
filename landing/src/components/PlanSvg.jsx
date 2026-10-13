import { useMemo } from 'react';

/* Draws a real plan (rectangles exported from the validator-checked band format) as SVG.
   `stage` reveals layers one by one, so the "how it works" panel can build the plan up:
     0 plot outline + setbacks   1 rooms   2 names and sizes   3 attached baths marked   4 walking route */

const NAME = {
  master: 'Master bedroom', bed: 'Bedroom', bath: 'Bath', kitchen: 'Kitchen', lounge: 'TV lounge', drawing: 'Drawing room',
  dining: 'Dining', lobby: 'Entrance', lawn: 'Front lawn', courtyard: 'Courtyard', stairs: 'Stairs', store: 'Store',
};
const SHORT = { master: 'Master', bed: 'Bedroom', lounge: 'Lounge', drawing: 'Drawing', lobby: 'Entrance', kitchen: 'Kitchen', dining: 'Dining' };
const FILLED = new Set(['lounge', 'drawing', 'dining', 'kitchen', 'master', 'bed', 'bath', 'lobby', 'lawn', 'courtyard']);
const OPEN = new Set(['lawn', 'void', 'courtyard', 'porch', 'garage', 'balcony']);

const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export default function PlanSvg({ data, plan, stage = 3, className = '', labels = true }) {
  const { w: W, d: D } = data.plot;
  const rooms = plan.rooms;

  const built = useMemo(() => rooms.filter((r) => !OPEN.has(r.t) && r.t !== 'bath'), [rooms]);
  const box = useMemo(() => ({
    x0: Math.min(...built.map((r) => r.x)), x1: Math.max(...built.map((r) => r.x + r.w)),
    y0: Math.min(...built.map((r) => r.y)), y1: Math.max(...built.map((r) => r.y + r.d)),
  }), [built]);

  const pad = 2.2;
  const Y = (y, h = 0) => D - y - h;                              // road at the bottom
  const find = (t) => built.find((r) => r.t === t);
  const centre = (r) => [r.x + r.w / 2, Y(r.y, r.d) + r.d / 2];
  const route = useMemo(() => {
    const lobby = find('lobby'), lounge = find('lounge'), master = find('master');
    if (!lobby || !lounge || !master) return null;
    const a = centre(lobby), b = centre(lounge), c = centre(master);
    return `M ${a[0]} ${D + 0.4} L ${a[0]} ${a[1]} L ${b[0]} ${b[1]} L ${c[0]} ${c[1]}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, D]);

  const layer = (on) => ({ opacity: on ? 1 : 0, transition: 'opacity 600ms var(--ease-out-expo)' });
  const fs = Math.max(0.9, W / 31);                                 // label size in feet, scales with the plot

  return (
    <svg viewBox={`${-pad} ${-pad} ${W + pad * 2} ${D + pad * 2 + 1.6}`} className={className} role="img"
      aria-label={`Floor plan of a ${W} by ${D} foot plot with ${data.beds} bedrooms`}>
      {/* plot + setbacks + overall dimensions */}
      <rect x="0" y="0" width={W} height={D} fill="none" stroke="var(--p-line)" strokeWidth="0.22" />
      <rect x={box.x0} y={Y(box.y0, box.y1 - box.y0)} width={box.x1 - box.x0} height={box.y1 - box.y0}
        fill="none" stroke="var(--accent)" strokeWidth="0.14" strokeDasharray="0.8 0.6" style={layer(stage === 0)} />
      <g className="num" fontSize={fs * 0.82} fill="var(--ink)" textAnchor="middle" style={{ opacity: 0.8 }}>
        <text x={W / 2} y={-0.9}>{W} ft</text>
        <text x={-1} y={D / 2} transform={`rotate(-90 -1 ${D / 2})`}>{D} ft</text>
        <text x={W / 2} y={D + 2.4} fontSize={fs * 0.72} style={{ opacity: 0.7 }}>ROAD</text>
      </g>

      {/* rooms */}
      <g style={layer(stage >= 1)}>
        {rooms.filter((r) => r.t !== 'void').map((r) => {
          const bath = r.t === 'bath';
          return (
            <rect key={r.i} x={r.x} y={Y(r.y, r.d)} width={r.w} height={r.d}
              fill={`var(--p-${FILLED.has(r.t) ? r.t : 'lounge'})`}
              stroke="var(--p-line)" strokeWidth={bath ? 0.1 : 0.16} strokeLinejoin="round"
              style={stage === 3 && bath ? { stroke: 'var(--accent)', strokeWidth: 0.26 } : undefined} />
          );
        })}
      </g>

      {/* names and sizes */}
      {labels && (
        <g style={layer(stage >= 2)}>
          {rooms.filter((r) => !['void', 'bath', 'lawn'].includes(r.t)).map((r) => {
            const nm = r.w < 9 ? SHORT[r.t] || NAME[r.t] : NAME[r.t] || r.t;
            const size = Math.min(fs, (r.w - 0.8) / (nm.length * 0.56));
            const x = r.x + 0.6, yb = Y(r.y, 0) - 0.6;
            return (
              <g key={r.i}>
                <text x={x} y={yb - size * 1.15} fontSize={size} fontWeight="600" fill="var(--ink)">{nm}</text>
                <text x={x} y={yb} fontSize={size * 0.82} className="num" fill="var(--ink)" style={{ opacity: 0.72 }}>{fmt(r.w)} x {fmt(r.d)}</text>
              </g>
            );
          })}
          {(() => {
            const l = rooms.find((r) => r.t === 'lawn');
            return l ? <text x={l.x + 0.6} y={Y(l.y, 0) - 0.6} fontSize={fs} fontWeight="600" fill="var(--ink)">Front lawn</text> : null;
          })()}
        </g>
      )}

      {/* walking route */}
      {route && (
        <g style={layer(stage >= 4)}>
          <path d={route} fill="none" stroke="var(--accent)" strokeWidth="0.42" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1.2 1.2" className="march" />
          <circle r="0.9" fill="var(--accent)">
            <animateMotion dur="5s" repeatCount="indefinite" path={route} />
          </circle>
        </g>
      )}
    </svg>
  );
}
