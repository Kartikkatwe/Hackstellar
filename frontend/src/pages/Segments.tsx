import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { useApi } from '../lib/api'
import { useFilters } from '../lib/filters'
import type { Compare, Config, Heatmap } from '../lib/types'
import { segmentValue } from '../lib/format'
import { Skeleton } from '../components/ui'
import './Segments.css'

/* Who is hit hardest. Lift = the group's rate ÷ everyone's rate, so a big group never looks
   worst just for being big. Diverging scale: cool below 1×, grey at 1×, warm above
   (dataviz: two opposite hues, neutral midpoint), and the value is printed in every cell. */

function mix(a: [number, number, number], b: [number, number, number], t: number) {
  return a.map((x, i) => Math.round(x + (b[i] - x) * t)) as [number, number, number]
}
const MID: [number, number, number] = [36, 36, 40]
const WARM: [number, number, number] = [217, 101, 46]
const COOL: [number, number, number] = [63, 134, 224]

function liftColor(lift: number) {
  const t = Math.max(-1, Math.min(1, Math.log2(Math.max(0.01, lift)) / 1.2))
  const rgb = t >= 0 ? mix(MID, WARM, t) : mix(MID, COOL, -t * 0.85)
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
  return { bg: `rgb(${rgb.join(',')})`, fg: lum > 0.55 ? '#140c06' : '#f2efe8' }
}

export default function Segments() {
  const reduce = useReducedMotion()
  const nav = useNavigate()
  const { set } = useFilters()
  const { data: config } = useApi<Config>('/config')
  const dims = config?.segments ?? []
  const [dim, setDim] = useState<string>('state')
  const seg = dims.find((d) => d.key === dim) ?? dims[0]
  const { data: heat } = useApi<Heatmap>(seg ? `/segments/heatmap?dim=${seg.key}` : null, 10000)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)

  const values = useMemo(() => (seg ? seg.values.map(String) : []), [seg])
  const [a, setA] = useState<string>('')
  const [b, setB] = useState<string>('')
  useEffect(() => {
    if (values.length >= 2) {
      const prefer = seg?.key === 'is_student' ? ['true', 'false'] : values
      setA(prefer[0])
      setB(prefer[1])
    }
  }, [values, seg?.key])
  const { data: cmp } = useApi<Compare>(seg && a && b && a !== b ? `/segments/compare?dim=${seg.key}&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}` : null, 10000)

  const cols = heat ? Object.keys(heat.segment_sizes) : []

  return (
    <div className="segs">
      <header className="phead">
        <div>
          <h1>Who is hit hardest</h1>
          <p>Each cell compares a group with everyone: 2× means that group is twice as likely to report the issue. Click a cell to re-rank the whole console for that group.</p>
        </div>
        <div className="phead__right">
          <div className="seg" role="group" aria-label="Customer group">
            {dims.map((d) => (
              <button key={d.key} aria-pressed={seg?.key === d.key} onClick={() => setDim(d.key)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <section className="panel" aria-labelledby="heat-h">
        <div className="panel__head">
          <div>
            <h2 id="heat-h" className="panel__title">
              Top 10 issues by {heat?.label.toLowerCase() ?? '…'}
            </h2>
            <p className="segs__sub">Rate = customers with the issue ÷ customers in the group.</p>
          </div>
          <div className="segs__scale" aria-hidden="true">
            <span>Less likely</span>
            <span className="segs__ramp" />
            <span>More likely</span>
          </div>
        </div>
        <div className="panel__body segs__heat-wrap">
          {!heat ? (
            <Skeleton h={420} />
          ) : (
            <table className="heat">
              <thead>
                <tr>
                  <th className="heat__issue">Issue</th>
                  {cols.map((c) => (
                    <th key={c}>
                      <span>{segmentValue(c)}</span>
                      <span className="heat__size">{heat.segment_sizes[c]} customers</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heat.rows.map((row, ri) => (
                  <tr key={row.issue_id}>
                    <th scope="row" className="heat__issue">
                      <span className="heat__rank mono">{row.rank}</span>
                      {row.title}
                    </th>
                    {cols.map((c, ci) => {
                      const cell = row.values[c]
                      if (!cell) return <td key={c} />
                      const col = liftColor(cell.lift)
                      return (
                        <td key={c}>
                          <motion.button
                            className="heat__cell"
                            style={{ background: col.bg, color: col.fg }}
                            initial={reduce ? false : { opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: reduce ? 0 : ri * 0.025 + ci * 0.02, duration: 0.3 }}
                            onMouseMove={(e) =>
                              setTip({
                                x: e.clientX,
                                y: e.clientY,
                                text: `${segmentValue(c)}: ${cell.affected} of ${heat.segment_sizes[c]} customers (${(cell.rate * 100).toFixed(1)}%), ${cell.lift.toFixed(2)}× everyone's rate`,
                              })
                            }
                            onMouseLeave={() => setTip(null)}
                            onClick={() => {
                              set(heat.dimension, c)
                              nav('/console')
                            }}
                            aria-label={`${row.title}, ${segmentValue(c)}: ${cell.lift.toFixed(2)} times everyone's rate, ${cell.affected} customers. Show the Top 10 for ${segmentValue(c)}.`}
                          >
                            <strong>{cell.lift.toFixed(1)}×</strong>
                            <span>{Math.round(cell.rate * 100)}%</span>
                          </motion.button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="panel" aria-labelledby="cmp-h2">
        <div className="panel__head segs__cmp-head">
          <div>
            <h2 id="cmp-h2" className="panel__title">
              Two groups, side by side
            </h2>
            <p className="segs__sub">Each line follows one issue from its rank in one group to its rank in the other.</p>
          </div>
          <div className="segs__pick">
            <select className="select" value={a} onChange={(e) => setA(e.target.value)} aria-label="First group">
              {values.map((v) => (
                <option key={v} value={v}>
                  {segmentValue(v)}
                </option>
              ))}
            </select>
            <span className="muted">vs</span>
            <select className="select" value={b} onChange={(e) => setB(e.target.value)} aria-label="Second group">
              {values.map((v) => (
                <option key={v} value={v}>
                  {segmentValue(v)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="panel__body">{cmp ? <Bump cmp={cmp} /> : <Skeleton h={420} />}</div>
      </section>

      {tip && (
        <div className="tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 300), top: tip.y + 14 }}>
          {tip.text}
        </div>
      )}
    </div>
  )
}

function Bump({ cmp }: { cmp: Compare }) {
  const [hover, setHover] = useState<number | null>(null)
  const A = cmp.a.issues.slice(0, 10)
  const B = cmp.b.issues.slice(0, 10)
  const rowH = 44
  const H = rowH * 11 + 20
  const W = 1000
  const xa = 330
  const xb = 670
  const y = (rank: number) => 30 + (Math.min(rank, 11) - 1) * rowH
  const posB = new Map(B.map((i) => [i.issue_id, i.rank]))

  return (
    <div className="bump">
      <svg viewBox={`0 0 ${W} ${H}`} className="bump__svg" role="img" aria-label={`Ranks for ${segmentValue(cmp.a.value)} against ${segmentValue(cmp.b.value)}`}>
        <text x={xa} y={10} textAnchor="end" className="bump__col">
          {segmentValue(cmp.a.value)}
        </text>
        <text x={xb} y={10} className="bump__col">
          {segmentValue(cmp.b.value)}
        </text>
        <text x={xb + 14} y={y(11) + 5} className="bump__out">
          outside their Top 10
        </text>
        {A.map((i) => {
          const rb = posB.get(i.issue_id) ?? (i.rank_in_other && i.rank_in_other <= 10 ? i.rank_in_other : 11)
          const ya = y(i.rank)
          const yb = y(rb)
          const diff = rb - i.rank
          const tone = diff >= 3 ? 'hot' : diff <= -3 ? 'cool' : 'even'
          const on = hover === i.issue_id
          return (
            <g key={i.issue_id} className={`bump__line is-${tone}${on ? ' is-on' : ''}${hover && !on ? ' is-dim' : ''}`} onMouseEnter={() => setHover(i.issue_id)} onMouseLeave={() => setHover(null)}>
              <path d={`M${xa + 8} ${ya} C${(xa + xb) / 2} ${ya} ${(xa + xb) / 2} ${yb} ${xb - 8} ${yb}`} />
              <circle cx={xa + 8} cy={ya} r="5" />
              <circle cx={xb - 8} cy={yb} r="5" />
              <text x={xa - 12} y={ya + 5} textAnchor="end" className="bump__label">
                <tspan className="bump__rank">{i.rank}</tspan> {i.title.length > 38 ? i.title.slice(0, 37) + '…' : i.title}
              </text>
            </g>
          )
        })}
        {B.map((i) => (
          <text key={i.issue_id} x={xb + 12} y={y(i.rank) + 5} className={`bump__label${hover === i.issue_id ? ' is-on' : ''}`}>
            <tspan className="bump__rank">{i.rank}</tspan> {i.title.length > 38 ? i.title.slice(0, 37) + '…' : i.title}
          </text>
        ))}
      </svg>
      <div className="bump__keys">
        <span>
          <i className="is-hot" /> Much higher for {segmentValue(cmp.a.value)}
        </span>
        <span>
          <i className="is-cool" /> Much lower for {segmentValue(cmp.a.value)}
        </span>
      </div>
    </div>
  )
}
