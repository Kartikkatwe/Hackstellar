import { useEffect, useMemo, useRef } from 'react'
import { useReducedMotion } from 'motion/react'
import { isMotionPaused, useMotionPaused } from '../lib/motion'
import type { Funnel } from '../lib/types'
import { int, pct } from '../lib/format'
import './FunnelFlow.css'

/* The funnel as a river: every complaint enters on the left, cheap checks peel most of them off
   into "filed", and only a thread reaches the LLM.
   Why a Sankey and not bars: the story is where complaints leave, not how big each stage is.
   Why particles: the same picture breathes, and live complaints raise the counts underneath.
   Geometry is pure arithmetic on GET /funnel, so the picture is the data. */

const W = 1200
const H = 470
const SPINE = 262 // top edge of the main band
const RAIL = 46 // top edge of the "filed" rail
const MAXT = 124 // band thickness for all complaints

type Span = { x: number; a: number; b: number }
type Ribbon = { id: string; from: Span; to: Span; color: string; fill: string }

function ribbonPath(r: Ribbon) {
  const { from: f, to: t } = r
  const xm = (f.x + t.x) / 2
  return `M${f.x} ${f.a} C${xm} ${f.a} ${xm} ${t.a} ${t.x} ${t.a} L${t.x} ${t.b} C${xm} ${t.b} ${xm} ${f.b} ${f.x} ${f.b} Z`
}

function bez(p0: number, p1: number, p2: number, p3: number, t: number) {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

export function buildFlow(f: Funnel) {
  const get = (s: string) => f.stages.find((x) => x.stage === s)?.count ?? 0
  const total = Math.max(1, f.total)
  const dropped = get('dropped')
  const match = get('match')
  const verify = get('verify')
  const llm = get('llm')
  const fresh = get('new_issue')
  const waiting = get('pending')
  const reachedLlm = Math.max(llm, Math.min(f.llm_adjudications, total))
  const pass = total - dropped
  const afterMatch = pass - match
  const afterVerify = afterMatch - verify
  const llmToBuffer = Math.max(0, reachedLlm - llm)
  const bypass = Math.max(0, afterVerify - reachedLlm)
  const buffer = fresh + waiting
  const k = MAXT / total
  const t = (n: number) => n * k

  const X = { in: 40, gate: 250, sim: 470, ver: 690, llm: 900, buf: 1040, end: 1170, drop: 380, railStart: 590 }
  const filedMatch = match
  const filedVer = match + verify
  const filedAll = match + verify + llm

  const ribbons: Ribbon[] = [
    { id: 'in', from: { x: X.in, a: SPINE, b: SPINE + t(total) }, to: { x: X.gate, a: SPINE, b: SPINE + t(total) }, color: 'spine', fill: 'url(#ff-spine)' },
    { id: 'drop', from: { x: X.gate, a: SPINE + t(pass), b: SPINE + t(total) }, to: { x: X.drop, a: H - 30 - t(dropped), b: H - 30 }, color: 'dropped', fill: 'var(--st-dropped)' },
    { id: 'pass', from: { x: X.gate, a: SPINE, b: SPINE + t(pass) }, to: { x: X.sim, a: SPINE, b: SPINE + t(pass) }, color: 'spine', fill: 'url(#ff-spine)' },
    { id: 'match', from: { x: X.sim, a: SPINE, b: SPINE + t(match) }, to: { x: X.railStart, a: RAIL, b: RAIL + t(match) }, color: 'match', fill: 'url(#ff-match)' },
    { id: 'rest1', from: { x: X.sim, a: SPINE + t(match), b: SPINE + t(pass) }, to: { x: X.ver, a: SPINE, b: SPINE + t(afterMatch) }, color: 'spine', fill: 'url(#ff-spine)' },
    { id: 'verify', from: { x: X.ver, a: SPINE, b: SPINE + t(verify) }, to: { x: X.ver + 120, a: RAIL + t(filedMatch), b: RAIL + t(filedVer) }, color: 'verify', fill: 'url(#ff-verify)' },
    { id: 'toLlm', from: { x: X.ver, a: SPINE + t(verify), b: SPINE + t(verify + reachedLlm) }, to: { x: X.llm, a: SPINE, b: SPINE + t(reachedLlm) }, color: 'spine', fill: 'url(#ff-spine)' },
    { id: 'bypass', from: { x: X.ver, a: SPINE + t(verify + reachedLlm), b: SPINE + t(afterMatch) }, to: { x: X.buf, a: SPINE + t(llmToBuffer), b: SPINE + t(llmToBuffer + bypass) }, color: 'spine', fill: 'url(#ff-spine)' },
    { id: 'llm', from: { x: X.llm, a: SPINE, b: SPINE + t(llm) }, to: { x: X.llm + 100, a: RAIL + t(filedVer), b: RAIL + t(filedAll) }, color: 'llm', fill: 'var(--st-llm)' },
    { id: 'llmBuf', from: { x: X.llm, a: SPINE + t(llm), b: SPINE + t(reachedLlm) }, to: { x: X.buf, a: SPINE, b: SPINE + t(llmToBuffer) }, color: 'spine', fill: 'url(#ff-spine)' },
    { id: 'new', from: { x: X.buf + 14, a: SPINE, b: SPINE + t(fresh) }, to: { x: X.end, a: SPINE - 6, b: SPINE - 6 + t(fresh) }, color: 'new', fill: 'var(--st-new)' },
    { id: 'wait', from: { x: X.buf + 14, a: SPINE + t(fresh), b: SPINE + t(buffer) }, to: { x: X.end, a: SPINE + 26, b: SPINE + 26 + t(waiting) }, color: 'pending', fill: 'var(--st-pending)' },
    { id: 'rail1', from: { x: X.railStart, a: RAIL, b: RAIL + t(filedMatch) }, to: { x: X.ver + 120, a: RAIL, b: RAIL + t(filedMatch) }, color: 'match', fill: 'url(#ff-rail)' },
    { id: 'rail2', from: { x: X.ver + 120, a: RAIL, b: RAIL + t(filedVer) }, to: { x: X.llm + 100, a: RAIL, b: RAIL + t(filedVer) }, color: 'match', fill: 'url(#ff-rail)' },
    { id: 'rail3', from: { x: X.llm + 100, a: RAIL, b: RAIL + t(filedAll) }, to: { x: X.end, a: RAIL, b: RAIL + t(filedAll) }, color: 'match', fill: 'url(#ff-rail)' },
  ]

  const byId = Object.fromEntries(ribbons.map((r) => [r.id, r]))
  // Particle routes, weighted by how many complaints really took each path.
  const routes = [
    { ids: ['in', 'drop'], w: dropped, color: '#8a857a' },
    { ids: ['in', 'pass', 'match', 'rail1', 'rail2', 'rail3'], w: match, color: '#f3ddb0' },
    { ids: ['in', 'pass', 'rest1', 'verify', 'rail2', 'rail3'], w: verify, color: '#ddb66f' },
    { ids: ['in', 'pass', 'rest1', 'toLlm', 'llm', 'rail3'], w: llm, color: '#e0a65a' },
    { ids: ['in', 'pass', 'rest1', 'toLlm', 'llmBuf', 'new'], w: buffer ? (llmToBuffer * fresh) / buffer : 0, color: '#b88a45' },
    { ids: ['in', 'pass', 'rest1', 'toLlm', 'llmBuf', 'wait'], w: buffer ? (llmToBuffer * waiting) / buffer : 0, color: '#9a958a' },
    { ids: ['in', 'pass', 'rest1', 'bypass', 'new'], w: buffer ? (bypass * fresh) / buffer : 0, color: '#b88a45' },
    { ids: ['in', 'pass', 'rest1', 'bypass', 'wait'], w: buffer ? (bypass * waiting) / buffer : 0, color: '#9a958a' },
  ].map((r) => ({ ...r, ribbons: r.ids.map((id) => byId[id]) }))

  return {
    ribbons,
    routes,
    X,
    nums: { total, dropped, match, verify, llm, fresh, waiting, reachedLlm, filedAll, pass, buffer },
    k,
  }
}

export function FunnelFlow({ funnel, compact = false }: { funnel: Funnel; compact?: boolean }) {
  const reduce = useReducedMotion()
  const paused = useMotionPaused()
  const flow = useMemo(() => buildFlow(funnel), [funnel])
  const canvas = useRef<HTMLCanvasElement>(null)
  const flowRef = useRef(flow)
  flowRef.current = flow

  useEffect(() => {
    if (reduce) return
    const cv = canvas.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    type P = { route: number; seg: number; t: number; f: number; speed: number; px: number; py: number }
    let parts: P[] = []
    let raf = 0
    let last = performance.now()
    let acc = 0
    let visible = true
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting))
    io.observe(cv)

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.round(cv.clientWidth * dpr)
      cv.height = Math.round(cv.clientHeight * dpr)
      ctx.setTransform((cv.width / W), 0, 0, cv.height / H, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(cv)

    const pick = () => {
      const routes = flowRef.current.routes
      const sum = routes.reduce((a, r) => a + r.w, 0)
      let x = Math.random() * sum
      for (let i = 0; i < routes.length; i++) {
        x -= routes[i].w
        if (x <= 0) return i
      }
      return 0
    }

    const pos = (p: P) => {
      const rb = flowRef.current.routes[p.route]?.ribbons[p.seg]
      if (!rb) return null
      const { from: f, to: t } = rb
      const y0 = f.a + p.f * (f.b - f.a)
      const y1 = t.a + p.f * (t.b - t.a)
      const xm = (f.x + t.x) / 2
      return [bez(f.x, xm, xm, t.x, p.t), bez(y0, y0, y1, y1, p.t)] as const
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!visible || document.hidden || isMotionPaused()) return
      acc += dt * 70
      while (acc > 1 && parts.length < 520) {
        acc -= 1
        parts.push({ route: pick(), seg: 0, t: 0, f: 0.08 + Math.random() * 0.84, speed: 150 + Math.random() * 70, px: NaN, py: NaN })
      }
      ctx.clearRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'lighter'
      const routes = flowRef.current.routes
      parts = parts.filter((p) => {
        const route = routes[p.route]
        if (!route) return false
        const rb = route.ribbons[p.seg]
        const len = Math.abs(rb.to.x - rb.from.x) + Math.abs(rb.to.a - rb.from.a) * 0.6 + 1
        p.t += (dt * p.speed) / len
        if (p.t >= 1) {
          p.seg += 1
          p.t = 0
          if (p.seg >= route.ribbons.length) return false
        }
        const xy = pos(p)
        if (!xy) return false
        const [x, y] = xy
        const end = p.seg === route.ribbons.length - 1 ? 1 - p.t : 1
        ctx.globalAlpha = Math.max(0, Math.min(1, end * 4)) * (route.color === '#8a857a' ? 0.55 : 0.95)
        ctx.strokeStyle = route.color
        ctx.lineWidth = 1.6
        if (!Number.isNaN(p.px)) {
          ctx.beginPath()
          ctx.moveTo(p.px, p.py)
          ctx.lineTo(x, y)
          ctx.stroke()
        }
        ctx.fillStyle = route.color
        ctx.beginPath()
        ctx.arc(x, y, 1.5, 0, Math.PI * 2)
        ctx.fill()
        p.px = x
        p.py = y
        return true
      })
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      ro.disconnect()
    }
  }, [reduce])

  const { X, nums } = flow
  const share = (n: number) => pct(n / Math.max(1, nums.total))
  const labelY = SPINE - 26

  return (
    <div className={`ff${compact ? ' ff--compact' : ''}`}>
      <div className="ff__stage">
        <svg viewBox={`0 0 ${W} ${H}`} className="ff__svg" role="img" aria-label={`Funnel: ${nums.total} complaints. ${nums.dropped} dropped at the gate, ${nums.match} filed by similarity, ${nums.verify} filed by Jev, ${nums.llm} filed by the LLM, ${nums.fresh} became new issues, ${nums.waiting} waiting.`}>
          <defs>
            <linearGradient id="ff-spine" x1="0" x2="1">
              <stop offset="0" stopColor="#3a3833" stopOpacity=".55" />
              <stop offset="1" stopColor="#2c2b28" stopOpacity=".55" />
            </linearGradient>
            <linearGradient id="ff-match" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#f3ddb0" stopOpacity=".1" />
              <stop offset="1" stopColor="#f3ddb0" stopOpacity=".34" />
            </linearGradient>
            <linearGradient id="ff-verify" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#ddb66f" stopOpacity=".1" />
              <stop offset="1" stopColor="#ddb66f" stopOpacity=".36" />
            </linearGradient>
            <linearGradient id="ff-rail" x1="0" x2="1">
              <stop offset="0" stopColor="#f3ddb0" stopOpacity=".22" />
              <stop offset="1" stopColor="#d9b26b" stopOpacity=".42" />
            </linearGradient>
          </defs>

          {/* stage rules */}
          {[
            { x: X.gate, name: 'Gate', who: 'Jev · every complaint' },
            { x: X.sim, name: 'Similarity', who: 'Local · free' },
            { x: X.ver, name: 'Verify', who: 'Jev · yes or no' },
            { x: X.llm, name: 'LLM', who: 'Claude Haiku 5.5' },
            { x: X.buf, name: 'Waiting list', who: '3 customers rule' },
          ].map((s) => (
            <g key={s.name} className={`ff__rule${s.name === 'LLM' ? ' is-llm' : ''}`}>
              <line x1={s.x} x2={s.x} y1={RAIL - 18} y2={H - 46} />
              <text x={s.x + 10} y={H - 22} className="ff__rule-name">
                {s.name}
              </text>
              <text x={s.x + 10} y={H - 4} className="ff__rule-who">
                {s.who}
              </text>
            </g>
          ))}

          {flow.ribbons.map((r) => (
            <path key={r.id} d={ribbonPath(r)} fill={r.fill} className={`ff__band ff__band--${r.color}`} />
          ))}

          {/* nodes */}
          <rect x={X.in - 14} y={SPINE} width="14" height={MAXT} rx="3" fill="var(--ink-2)" />
          <rect x={X.end} y={RAIL} width="14" height={Math.max(2, nums.filedAll * flow.k)} rx="3" fill="var(--brass)" />

          {/* labels */}
          <g className="ff__lbl">
            <text x={X.in - 14} y={SPINE - 34} className="ff__big">
              {int(nums.total)}
            </text>
            <text x={X.in - 14} y={SPINE - 12} className="ff__sub">
              complaints in
            </text>

            <text x={X.drop + 18} y={H - 82} className="ff__sub">
              not complaints, dropped
            </text>
            <text x={X.drop + 18} y={H - 58} className="ff__val">
              {int(nums.dropped)} <tspan className="ff__pct">{share(nums.dropped)}</tspan>
            </text>

            <text x={X.sim + 12} y={labelY - 18} className="ff__val">
              {int(nums.match)} <tspan className="ff__pct">{share(nums.match)}</tspan>
            </text>
            <text x={X.sim + 12} y={labelY} className="ff__sub">
              filed by similarity
            </text>

            <text x={X.ver + 12} y={labelY - 18} className="ff__val">
              {int(nums.verify)} <tspan className="ff__pct">{share(nums.verify)}</tspan>
            </text>
            <text x={X.ver + 12} y={labelY} className="ff__sub">
              filed by Jev
            </text>

            <text x={X.llm + 12} y={SPINE + 30} className="ff__val ff__val--llm">
              {int(nums.reachedLlm)} <tspan className="ff__pct">{share(nums.reachedLlm)}</tspan>
            </text>
            <text x={X.llm + 12} y={SPINE + 50} className="ff__sub">
              reached the LLM
            </text>
            <text x={X.llm + 12} y={SPINE + 68} className="ff__sub">
              {int(nums.llm)} filed by it
            </text>

            <text x={X.end - 8} y={SPINE - 20} className="ff__sub" textAnchor="end">
              {int(nums.fresh)} new issues · {int(nums.waiting)} waiting
            </text>

            <text x={X.end - 8} y={RAIL + nums.filedAll * flow.k + 30} className="ff__val" textAnchor="end">
              {int(nums.filedAll)} <tspan className="ff__pct">{share(nums.filedAll)}</tspan>
            </text>
            <text x={X.end - 8} y={RAIL + nums.filedAll * flow.k + 50} className="ff__sub" textAnchor="end">
              filed under an issue
            </text>
          </g>
        </svg>
        {!reduce && <canvas ref={canvas} className="ff__canvas" aria-hidden="true" style={paused ? { opacity: 0.35 } : undefined} />}
      </div>

      {/* Table twin of the chart (dataviz rule: every chart has a table view), shown on small screens. */}
      <table className="table ff__table">
        <caption className="sr-only">Where complaints settled</caption>
        <thead>
          <tr>
            <th>Stage</th>
            <th className="r">Complaints</th>
            <th className="r">Share</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['Dropped at the gate', nums.dropped],
            ['Filed by similarity', nums.match],
            ['Filed by Jev', nums.verify],
            ['Filed by the LLM', nums.llm],
            ['Became new issues', nums.fresh],
            ['Waiting', nums.waiting],
          ].map(([name, n]) => (
            <tr key={name as string}>
              <td>{name}</td>
              <td className="r">{int(n as number)}</td>
              <td className="r">{share(n as number)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
