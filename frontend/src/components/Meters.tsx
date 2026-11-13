import { motion, useReducedMotion } from 'motion/react'
import { useApi } from '../lib/api'
import type { Config } from '../lib/types'
import './Meters.css'

/* Severity, money lost and anger as three gauges, each filled up to where the issue is,
   with a line where it crosses a cut-off. Customers stay a plain number beside them.
   Why (13 Nov, Kartik): a stacked "share of the score" bar needed a legend and still read
   as noise to judges; "how full, and is it past the line" reads at a glance.
   Cut-offs are the ranker's own (ranker.py / pack.yaml), not new rules:
     money: Critical from critical_money_share (0.5) of complaints reporting money lost
     anger: the "angry" flag from 0.4 of complaints sounding angry
     severity: average impact 1 (Annoyed) to 4 (Harmed); the ticks are the level boundaries.
   Colours are the Overview palette (no new colours). */

export const FACTORS: Record<string, { name: string; color: string }> = {
  customers: { name: 'Customers', color: '#3987e5' },
  impact: { name: 'Severity', color: '#d95926' },
  money: { name: 'Money lost', color: '#199e70' },
  anger: { name: 'Anger', color: '#c98500' },
  trend: { name: 'Trend', color: '#d55181' },
}

const ANGRY_FLAG = 0.4 // ranker.py: flags "angry" at this share
const DEFAULT_LEVELS = ['Annoyed', 'Inconvenienced', 'Blocked', 'Harmed']

type S = { avg_impact: number; money_share: number; angry_share: number }

export function Meters({ s, compact = false }: { s: S; compact?: boolean }) {
  const reduce = useReducedMotion()
  const { data: config } = useApi<Config>('/config')
  const levels = config?.impact_levels.map((l) => l.split(':')[0]) ?? DEFAULT_LEVELS
  const moneyLine = config?.ranking.critical_money_share ?? 0.5
  const level = levels[Math.min(levels.length - 1, Math.max(0, Math.round(s.avg_impact) - 1))]
  const pct = (x: number) => `${Math.round(x * 100)}%`

  const rows = [
    {
      key: 'impact',
      fill: (s.avg_impact - 1) / 3,
      value: level,
      ticks: [1 / 3, 2 / 3],
      line: null as number | null,
      over: s.avg_impact >= 3.5,
      note: `average of ${levels[0]} to ${levels[levels.length - 1]}`,
    },
    {
      key: 'money',
      fill: s.money_share,
      value: pct(s.money_share),
      ticks: [],
      line: moneyLine,
      over: s.money_share >= moneyLine,
      note: `of complaints lost money · Critical from ${pct(moneyLine)}`,
    },
    {
      key: 'anger',
      fill: s.angry_share,
      value: pct(s.angry_share),
      ticks: [],
      line: ANGRY_FLAG,
      over: s.angry_share >= ANGRY_FLAG,
      note: `of complaints sound angry · flagged from ${pct(ANGRY_FLAG)}`,
    },
  ]

  return (
    <div className={`mtr${compact ? ' mtr--compact' : ''}`}>
      {!compact && <span className="mtr__title">Severity score</span>}
      {rows.map((r, i) => {
        const f = FACTORS[r.key]
        return (
          <div
            key={r.key}
            className={`mtr__row${r.over ? ' is-over' : ''}`}
            style={{ ['--c' as string]: f.color }}
            title={`${f.name}: ${r.value} ${r.note}`}
          >
            <span className="mtr__name">{f.name}</span>
            <span className="mtr__val">{r.value}</span>
            <span
              className="mtr__track"
              role="meter"
              aria-label={f.name}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(r.fill * 100)}
              aria-valuetext={`${r.value} ${r.note}`}
            >
              <motion.span
                className="mtr__fill"
                style={{ width: `${Math.max(2, Math.min(100, r.fill * 100))}%` }}
                initial={reduce || compact ? false : { scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: 0.1 + i * 0.1, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              />
              {r.ticks.map((t) => (
                <i key={t} className="mtr__tick" style={{ left: `${t * 100}%` }} aria-hidden="true" />
              ))}
              {r.line !== null && <i className="mtr__line" style={{ left: `${r.line * 100}%` }} aria-hidden="true" />}
            </span>
            {!compact && <span className="mtr__note">{r.note}</span>}
          </div>
        )
      })}
    </div>
  )
}

/** One key for a list of compact gauges (Top issues). */
export function MetersKey() {
  return (
    <span className="mtr__key">
      <i className="mtr__keyline" aria-hidden="true" /> Bars fill up as it gets worse; past the white line means Critical (money) or flagged (anger).
    </span>
  )
}
