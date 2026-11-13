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
  customers: { name: 'Customers', color: '#3987e5' },
  impact: { name: 'Impact', color: '#d95926' },
  money: { name: 'Money lost', color: '#199e70' },
  anger: { name: 'Anger', color: '#c98500' },
  trend: { name: 'Trend', color: '#d55181' },
}

export function ScoreMap({ formula }: { formula: string }) {
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

  return (
    <div className="smap">
      <span className="smap__title">What drives the score</span>
      <div className="smap__bar" role="img" aria-label={`Share of the score, ${label}. Score ${result}.`}>
        {parts
          .filter((p) => p.weight > 0)
          .map((p, i) => (
            <motion.span
              key={p.key}
              className="smap__seg"
              style={{ flexGrow: p.weight / total, ['--c' as string]: p.color }}
              title={`${p.name}: ${p.value.toFixed(p.key === 'customers' ? 0 : 2)}, ${Math.round((p.weight / total) * 100)}% of the score`}
              initial={reduce ? false : { scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ delay: 0.1 + i * 0.12, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            />
          ))}
      </div>
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
