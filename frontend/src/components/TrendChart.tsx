import { useMemo, useRef, useState } from 'react'
import { scaleLinear } from 'd3-scale'
import { area, line, curveMonotoneX } from 'd3-shape'
import { day } from '../lib/format'
import './TrendChart.css'

/* Daily complaints for one issue. One series, so no legend box (dataviz rule); 2px line,
   10% wash, end dot with a surface ring, hairline grid, crosshair + tooltip on hover. */
export function TrendChart({ daily, height = 200 }: { daily: [string, number][]; height?: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  // Fill missing days with zero so gaps read as quiet days, not as interpolation.
  const data = useMemo(() => {
    if (!daily.length) return [] as [string, number][]
    const map = new Map(daily)
    const start = new Date(daily[0][0] + 'T00:00:00')
    const end = new Date(daily[daily.length - 1][0] + 'T00:00:00')
    const out: [string, number][] = []
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      out.push([key, map.get(key) ?? 0])
    }
    return out
  }, [daily])

  const W = 640
  const H = height
  const m = { t: 16, r: 18, b: 28, l: 34 }
  const max = Math.max(4, ...data.map((d) => d[1]))
  const x = scaleLinear()
    .domain([0, Math.max(1, data.length - 1)])
    .range([m.l, W - m.r])
  const y = scaleLinear()
    .domain([0, max])
    .nice(4)
    .range([H - m.b, m.t])
  const ticks = y.ticks(4)
  const ln = line<[string, number]>()
    .x((_, i) => x(i))
    .y((d) => y(d[1]))
    .curve(curveMonotoneX)(data)
  const ar = area<[string, number]>()
    .x((_, i) => x(i))
    .y0(H - m.b)
    .y1((d) => y(d[1]))
    .curve(curveMonotoneX)(data)
  const last = data.length - 1

  const onMove = (e: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box || !data.length) return
    const px = ((e.clientX - box.left) / box.width) * W
    const i = Math.round(x.invert(px))
    setHover(Math.max(0, Math.min(last, i)))
  }

  if (!data.length) return null
  const h = hover ?? null
  return (
    <div className="trend">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="trend__svg" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`Complaints per day: ${data.map(([d, n]) => `${day(d)} ${n}`).join(', ')}`}>
        <defs>
          <linearGradient id="trend-wash" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d9b26b" stopOpacity=".2" />
            <stop offset="1" stopColor="#d9b26b" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="trend__grid" />
            <text x={m.l - 8} y={y(t)} dy="0.35em" textAnchor="end" className="trend__tick">
              {t}
            </text>
          </g>
        ))}
        {data.map(([d], i) =>
          data.length <= 10 || i % Math.ceil(data.length / 8) === 0 || i === last ? (
            <text key={d} x={x(i)} y={H - 8} textAnchor="middle" className="trend__tick">
              {day(d)}
            </text>
          ) : null,
        )}
        <path d={ar ?? ''} fill="url(#trend-wash)" />
        <path d={ln ?? ''} className="trend__line" />
        {h != null && (
          <>
            <line x1={x(h)} x2={x(h)} y1={m.t} y2={H - m.b} className="trend__cross" />
            <circle cx={x(h)} cy={y(data[h][1])} r="5" className="trend__dot" />
          </>
        )}
        <circle cx={x(last)} cy={y(data[last][1])} r="4.5" className="trend__dot" />
        <text x={x(last)} y={y(data[last][1]) - 12} textAnchor="end" className="trend__end">
          {data[last][1]}
        </text>
      </svg>
      {h != null && (
        <div className="trend__tip" style={{ left: `${(x(h) / W) * 100}%` }}>
          <strong>{data[h][1]}</strong> {data[h][1] === 1 ? 'complaint' : 'complaints'} · {day(data[h][0])}
        </div>
      )}
    </div>
  )
}
