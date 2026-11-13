import { motion, useReducedMotion } from 'motion/react'
import { parseFormula } from './Formula'
import './ScoreMap.css'

/* What drives an issue's score, as a colour map instead of a row of numbers.
   Why widths in log space: the score is a product (customers × impact × money × anger ×
   trend), so each factor's share of log(score) is how much of the score it accounts for.
   A factor at 1.00 adds nothing and gets no segment; the key shows it faded.
   The exact numbers stay one hover away and on the issue page (transparency is the pitch).
   Palette: five categorical slots validated for colour-blind separation on the dark card. */

const FACTORS: Record<string, { name: string; color: string }> = {
  // Why these hues (13 Nov): Top issues shows this bar beside the channel bar, whose colours are
  // green, orange, blue and pink. Score factors use none of those, so no colour means two things.
  customers: { name: 'Customers', color: '#9b87f5' },
  impact: { name: 'Impact', color: '#e3c04a' },
  money: { name: 'Money lost', color: '#36c2cf' },
  anger: { name: 'Anger', color: '#a3d13b' },
  trend: { name: 'Trend', color: '#b8bcc4' },
}

/** The factor colours as one key, for lists that show many compact bars (Top issues). */
export function ScoreKey() {
  return (
    <ul className="smap__key" aria-label="What the colours mean">
      {Object.entries(FACTORS).map(([key, f]) => (
        <li key={key} style={{ ['--c' as string]: f.color }}>
          <i aria-hidden="true" />
          {f.name}
        </li>
      ))}
    </ul>
  )
}

/* compact: the bar alone, for a row in a list (Top issues); the page shows one ScoreKey.
   Why: a row of Jev-derived numbers per issue is hard to read at a glance; the colours
   show what drives each issue, and the exact numbers stay on hover and on the issue page. */
export function ScoreMap({ formula, scale, compact = false }: { formula: string; scale?: number; compact?: boolean }) {
  const reduce = useReducedMotion()
  const { factors, result } = parseFormula(formula)
  const parts = factors
    .filter((f) => FACTORS[f.name])
    .map((f) => {
      const value = parseFloat(f.value.replace(/,/g, ''))
      return { key: f.name, value, weight: Math.max(0, Math.log(value)), ...FACTORS[f.name] }
    })
  const total = parts.reduce((a, p) => a + p.weight, 0) || 1
  const label = parts.map((p) => `${p.name} ${p.weight > 0 ? `${Math.round((p.weight / total) * 100)}%` : 'no effect'}`).join(', ')

  const bar = (
    <div className={`smap__bar${compact ? ' smap__bar--compact' : ''}`} role="img" aria-label={`Share of the score, ${label}. Score ${result}.`}>
      {parts
        .filter((p) => p.weight > 0)
        .map((p, i) => (
          <motion.span
            key={p.key}
            className="smap__seg"
            style={{ flexGrow: p.weight / total, ['--c' as string]: p.color }}
            title={`${p.name}: ${p.value.toFixed(p.key === 'customers' ? 0 : 2)}, ${Math.round((p.weight / total) * 100)}% of the score`}
            initial={reduce || compact ? false : { scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ delay: 0.1 + i * 0.12, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          />
        ))}
    </div>
  )
  if (compact) return bar

  return (
    <div className="smap">
      <div className="smap__head">
        <span className="smap__title">What drives the score</span>
        <span className="smap__score" aria-label={`Score ${Math.round(parseFloat(result))} out of ${scale}`}>
          <b>{Math.round(parseFloat(result))}</b>
          <span>/ {scale ?? ''}</span>
        </span>
      </div>
      {bar}
      <ul className="smap__key">
        {parts.map((p) => (
          <li key={p.key} className={p.weight > 0 ? '' : 'is-none'} style={{ ['--c' as string]: p.color }}>
            <i aria-hidden="true" />
            {p.name}
            {p.weight <= 0 && <span>no effect</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
