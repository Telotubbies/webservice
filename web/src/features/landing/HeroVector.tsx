// Vector line drawing of the sorting line — the hero's fallback while the
// three.js twin loads, and the whole picture when WebGL is missing. Isometric
// strokes in currentColor so it follows the landing theme; the stone dots
// animate only under prefers-reduced-motion: no-preference (landing.css).

const iso = (x: number, y: number, z = 0) => {
  // 30° isometric: x runs down-right, y runs up-right, z is height
  const c = Math.cos(Math.PI / 6);
  return [300 + (x - y) * c * 40, 210 + (x + y) * 0.5 * 40 - z * 40] as const;
};
const pts = (p: (readonly [number, number])[]) => p.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');

function Prism({ x, y, w, d, h, z = 0, cls = '' }: { x: number; y: number; w: number; d: number; h: number; z?: number; cls?: string }) {
  const top = [iso(x, y, z + h), iso(x + w, y, z + h), iso(x + w, y + d, z + h), iso(x, y + d, z + h)];
  const left = [iso(x, y + d, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x, y + d, z + h)];
  const right = [iso(x + w, y, z), iso(x + w, y + d, z), iso(x + w, y + d, z + h), iso(x + w, y, z + h)];
  return (
    <g className={cls}>
      <polygon points={pts(left)} className="vz-f-l" />
      <polygon points={pts(right)} className="vz-f-r" />
      <polygon points={pts(top)} className="vz-f-t" />
    </g>
  );
}

export function HeroVector({ title }: { title: string }) {
  const [bx0, by0] = iso(-3, 0.2, 0.62);
  const [bx1, by1] = iso(3, 0.2, 0.62);
  return (
    <svg className="vz-vector" viewBox="0 0 600 420" role="img" aria-label={title}>
      {/* floor grid */}
      <g className="vz-grid">
        {Array.from({ length: 13 }, (_, i) => i - 6).map((i) => (
          <g key={i}>
            <line x1={iso(i, -6)[0]} y1={iso(i, -6)[1]} x2={iso(i, 6)[0]} y2={iso(i, 6)[1]} />
            <line x1={iso(-6, i)[0]} y1={iso(-6, i)[1]} x2={iso(6, i)[0]} y2={iso(6, i)[1]} />
          </g>
        ))}
      </g>
      <Prism x={-4.4} y={0.9} w={0.8} d={0.7} h={0.7} />
      <Prism x={-3} y={-0.35} w={6} d={1.1} h={0.12} z={0.5} cls="vz-belt" />
      {[-2.6, -1, 1, 2.6].map((x) => <Prism key={x} x={x} y={0.6} w={0.1} d={0.1} h={0.5} />)}
      {/* vision gantry */}
      <Prism x={0.35} y={0.6} w={0.1} d={0.1} h={1.5} z={0.62} />
      <Prism x={0.35} y={-0.7} w={0.1} d={0.1} h={1.5} z={0.62} />
      <Prism x={0.3} y={-0.7} w={0.2} d={1.4} h={0.1} z={2.1} />
      <Prism x={0.25} y={-0.15} w={0.3} d={0.3} h={0.26} z={1.84} cls="vz-cam" />
      <polygon className="vz-cone" points={pts([iso(0.4, 0, 1.84), iso(0, -0.5, 0.63), iso(0.8, 0.5, 0.63)])} />
      {/* bins */}
      <Prism x={3.6} y={0.6} w={1.2} d={1.1} h={0.6} cls="vz-bin" />
      <Prism x={3.6} y={-1.6} w={1.2} d={1.1} h={0.6} cls="vz-bin" />
      {/* stones riding the belt */}
      <g className="vz-stones">
        {Array.from({ length: 9 }, (_, i) => (
          <circle key={i} r={i % 3 === 2 ? 3 : 4.4} className={i % 3 === 2 ? 'is-sand' : 'is-gravel'}
            style={{
              offsetPath: `path('M${bx0.toFixed(1)},${(by0 - 4).toFixed(1)} L${bx1.toFixed(1)},${(by1 - 4).toFixed(1)}')`,
              offsetDistance: `${((i / 9) * 100).toFixed(1)}%`, animationDelay: `${(-i * 0.7).toFixed(1)}s`,
            }} />
        ))}
      </g>
    </svg>
  );
}
