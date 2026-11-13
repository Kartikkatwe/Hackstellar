import { useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import type { Issue } from '../lib/types'
import { BADGE } from '../lib/meta'
import { componentName } from '../lib/format'
import './CompassDial.css'

/* The compass: the business's areas around the bezel, the Top 10 inside, the needle on the
   issue that matters most (or the one you point at).
   Why radius = score: the further out, the more it hurts; #1 sits on the rim where the needle points.
   Why sector brightness = complaints: you see at a glance which part of the business is loud.
   Not: a radar/spider chart. Issues are not attributes; they are places on a map. */

const C = 300
const R_OUT = 286
const R_TICK = 268
const R_SECTOR = 238
const R_MIN = 70
const R_MAX = 206

const rad = (deg: number) => ((deg - 90) * Math.PI) / 180
const pt = (r: number, deg: number) => [C + r * Math.cos(rad(deg)), C + r * Math.sin(rad(deg))] as const

function arc(r: number, a0: number, a1: number) {
  const [x0, y0] = pt(r, a0)
  const [x1, y1] = pt(r, a1)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

export type DialMarker = { issue: Issue; angle: number; r: number; size: number; x: number; y: number }

export function useDialLayout(issues: Issue[], components: string[]) {
  return useMemo(() => {
    const n = Math.max(1, components.length)
    const span = 360 / n
    const maxScore = Math.max(1, ...issues.map((i) => i.score))
    const maxCust = Math.max(1, ...issues.map((i) => i.unique_customers))
    const byComp = new Map<string, Issue[]>()
    issues.forEach((i) => byComp.set(i.component, [...(byComp.get(i.component) ?? []), i]))
    const markers: DialMarker[] = []
    components.forEach((comp, ci) => {
      const list = (byComp.get(comp) ?? []).slice().sort((a, b) => a.rank - b.rank)
      const center = ci * span
      list.forEach((issue, k) => {
        const spread = list.length > 1 ? (k / (list.length - 1) - 0.5) * (span - 22) : 0
        const angle = center + spread
        const r = R_MIN + (R_MAX - R_MIN) * Math.pow(issue.score / maxScore, 0.8)
        const size = 10 + 6 * Math.sqrt(issue.unique_customers / maxCust)
        const [x, y] = pt(r, angle)
        markers.push({ issue, angle, r, size, x, y })
      })
    })
    return { markers, span }
  }, [issues, components])
}

export function CompassDial({
  issues,
  components,
  componentTotals,
  focusId,
  onFocus,
}: {
  issues: Issue[]
  components: string[]
  componentTotals: Record<string, number>
  focusId: number | null
  onFocus: (id: number | null) => void
}) {
  const reduce = useReducedMotion()
  const nav = useNavigate()
  const { markers, span } = useDialLayout(issues, components)
  const [tip, setTip] = useState<{ m: DialMarker; x: number; y: number } | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  const focus = markers.find((m) => m.issue.issue_id === focusId) ?? markers.slice().sort((a, b) => a.issue.rank - b.issue.rank)[0]

  // Unwrap the needle angle so a swing always takes the short way round.
  const lastAngle = useRef<number>(-120)
  const target = useMemo(() => {
    if (!focus) return lastAngle.current
    let a = focus.angle
    const cur = lastAngle.current
    while (a - cur > 180) a -= 360
    while (a - cur < -180) a += 360
    lastAngle.current = a
    return a
  }, [focus])

  const maxTotal = Math.max(1, ...Object.values(componentTotals))
  const PERIOD = 9

  return (
    <div className="dial" ref={wrap}>
      <svg viewBox="-130 -40 860 680" className="dial__svg" role="img" aria-label={`Compass of the Top ${issues.length} issues. The needle points at ${focus ? `#${focus.issue.rank} ${focus.issue.title}` : 'nothing yet'}.`}>
        <defs>
          <radialGradient id="dial-face" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#17171b" />
            <stop offset=".72" stopColor="#111114" />
            <stop offset="1" stopColor="#0c0c0e" />
          </radialGradient>
          <linearGradient id="dial-needle" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#9c7434" />
            <stop offset=".6" stopColor="#d9b26b" />
            <stop offset="1" stopColor="#f6e3b8" />
          </linearGradient>
          <radialGradient id="dial-sweep-g" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(300 300) scale(240)">
            <stop offset="0" stopColor="rgba(217,178,107,0)" />
            <stop offset="1" stopColor="rgba(217,178,107,.16)" />
          </radialGradient>
          <filter id="dial-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {/* bezel */}
        <circle cx={C} cy={C} r={R_OUT + 8} fill="none" stroke="#1c1c20" strokeWidth="1" />
        <circle cx={C} cy={C} r={R_OUT} fill="url(#dial-face)" stroke="#2d2d33" strokeWidth="1.2" />
        {Array.from({ length: 120 }, (_, i) => {
          const a = i * 3
          const major = i % 5 === 0
          const [x0, y0] = pt(R_TICK + (major ? 6 : 2), a)
          const [x1, y1] = pt(R_TICK - (major ? 8 : 3), a)
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={major ? '#4a4740' : '#2c2b28'} strokeWidth={major ? 1.4 : 1} />
        })}
        <path d={`M${C} ${C - R_TICK - 14} l-6 -10 h12 z`} fill="var(--brass)" />

        {/* importance rings: further out = higher score */}
        {[0.33, 0.66, 1].map((f) => (
          <circle key={f} cx={C} cy={C} r={R_MIN + (R_MAX - R_MIN) * f} fill="none" stroke="#202024" strokeWidth="1" />
        ))}
        <line x1={C} y1={C - R_MAX} x2={C} y2={C + R_MAX} stroke="#1d1d21" />
        <line x1={C - R_MAX} y1={C} x2={C + R_MAX} y2={C} stroke="#1d1d21" />

        {/* component sectors */}
        {components.map((comp, i) => {
          const a0 = i * span - span / 2 + 2.2
          const a1 = i * span + span / 2 - 2.2
          const share = (componentTotals[comp] ?? 0) / maxTotal
          const active = focus?.issue.component === comp
          const [lx, ly] = pt(R_OUT + 34, i * span)
          const anchor = Math.abs(lx - C) < 30 ? 'middle' : lx > C ? 'start' : 'end'
          return (
            <g key={comp} className={`dial__sector${active ? ' is-active' : ''}`}>
              <path d={arc(R_SECTOR, a0, a1)} stroke="#26262b" strokeWidth="12" fill="none" strokeLinecap="butt" />
              <path
                d={arc(R_SECTOR, a0, a1)}
                stroke="var(--brass)"
                strokeOpacity={0.18 + 0.72 * share}
                strokeWidth="12"
                fill="none"
                strokeLinecap="butt"
                className="dial__sector-fill"
              />
              <text x={lx} y={ly - 4} textAnchor={anchor} className="dial__comp">
                {componentName(comp)}
              </text>
              <text x={lx} y={ly + 14} textAnchor={anchor} className="dial__comp-n">
                {(componentTotals[comp] ?? 0).toLocaleString('en-IN')} complaints
              </text>
            </g>
          )
        })}

        {/* radar sweep: one slow brass pass; markers ping as it crosses them */}
        {!reduce && (
          <g className="dial__sweep" style={{ animationDuration: `${PERIOD}s` }}>
            <path d={`M${C} ${C} L${pt(R_MAX + 18, -28).join(' ')} A${R_MAX + 18} ${R_MAX + 18} 0 0 1 ${pt(R_MAX + 18, 0).join(' ')} Z`} fill="url(#dial-sweep-g)" />
            <line x1={C} y1={C} x2={C} y2={C - R_MAX - 18} stroke="rgba(243,221,176,.5)" strokeWidth="1" />
          </g>
        )}

      </svg>

      {/* Needle on its own HTML layer: the dial centre is exactly 50%/50% of the box, and CSS
          rotation about the centre is reliable where SVG transform origins are not. */}
      <motion.div
        className="dial__layer dial__needle"
        initial={{ rotate: reduce ? target : -140 }}
        animate={{ rotate: target }}
        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 46, damping: 7.5, mass: 1.25 }}
      >
        <svg viewBox="-130 -40 860 680" aria-hidden="true">
          <path d={`M${C} ${C - R_MAX + 2} L${C + 9} ${C} L${C} ${C} Z`} fill="url(#dial-needle)" />
          <path d={`M${C} ${C - R_MAX + 2} L${C - 9} ${C} L${C} ${C} Z`} fill="#f6e3b8" />
          <path d={`M${C} ${C + 62} L${C - 9} ${C} L${C} ${C} Z`} fill="#3b3933" />
          <path d={`M${C} ${C + 62} L${C + 9} ${C} L${C} ${C} Z`} fill="#2a2925" />
          <circle cx={C} cy={C - R_MAX + 2} r="3" fill="#f6e3b8" filter="url(#dial-glow)" opacity=".9" />
        </svg>
      </motion.div>

      <svg viewBox="-130 -40 860 680" className="dial__layer dial__top">
        <circle cx={C} cy={C} r="11" fill="#0a0a0b" stroke="#3a3a41" strokeWidth="1.5" />
        <circle cx={C} cy={C} r="4.5" fill="var(--brass-hi)" />

        {/* issue markers */}
        {markers.map((m) => {
          const isFocus = focus?.issue.issue_id === m.issue.issue_id
          const color = BADGE[m.issue.badge].color
          const delay = (((m.angle % 360) + 360) % 360) / 360 * PERIOD
          return (
            <g
              key={m.issue.issue_id}
              className={`dial__marker${isFocus ? ' is-focus' : ''}`}
              transform={`translate(${m.x} ${m.y})`}
              tabIndex={0}
              role="link"
              aria-label={`#${m.issue.rank} ${m.issue.title}, ${m.issue.badge}, ${m.issue.unique_customers} customers`}
              onMouseEnter={(e) => {
                onFocus(m.issue.issue_id)
                const box = wrap.current?.getBoundingClientRect()
                if (box) setTip({ m, x: e.clientX, y: e.clientY })
              }}
              onMouseMove={(e) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))}
              onMouseLeave={() => {
                setTip(null)
                onFocus(null)
              }}
              onFocus={() => onFocus(m.issue.issue_id)}
              onBlur={() => onFocus(null)}
              onClick={() => nav(`/console/issues/${m.issue.issue_id}`)}
              onKeyDown={(e) => e.key === 'Enter' && nav(`/console/issues/${m.issue.issue_id}`)}
            >
              {!reduce && <circle r={m.size + 10} className="dial__ping" style={{ animationDuration: `${PERIOD}s`, animationDelay: `${delay}s`, stroke: color }} />}
              <circle r={m.size + 14} fill="transparent" />
              <circle r={m.size + 2.5} fill="#111114" />
              <circle r={m.size} fill={color} className="dial__dot" />
              <text className="dial__rank" dy="0.35em" textAnchor="middle">
                {m.issue.rank}
              </text>
            </g>
          )
        })}
      </svg>
      {tip && (
        <div className="tip" style={{ left: Math.min(tip.x + 16, window.innerWidth - 300), top: tip.y + 16 }}>
          <strong>
            #{tip.m.issue.rank} {tip.m.issue.title}
          </strong>
          <div>
            {tip.m.issue.badge} · {componentName(tip.m.issue.component)}
          </div>
          <div className="num">
            {tip.m.issue.unique_customers} customers · score {tip.m.issue.score.toFixed(1)}
          </div>
        </div>
      )}
    </div>
  )
}
