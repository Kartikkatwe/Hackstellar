import { ScoreMap } from './ScoreMap'
import './ScoreWhy.css'

/* Why an issue ranks where it does, in plain words for people who have never seen the formula.
   Why (13 Nov): judges read "3.72 impact x 2.00 money x 1.12 anger" as noise. Each factor is
   said the way a support lead would say it, with the colour it has in the score bar below.
   The exact formula stays in the bar's hover text and in the API (transparency is kept). */

type Summary = {
  unique_customers: number
  avg_impact: number
  money_share: number
  angry_share: number
  trend: number
  formula: string
}

const share = (x: number) => {
  if (x >= 0.95) return 'almost all'
  if (x >= 0.7) return 'most'
  if (x >= 0.4) return 'about half'
  if (x >= 0.15) return 'some'
  return 'few'
}

export function ScoreWhy({ s, impactNames }: { s: Summary; impactNames: string[] }) {
  const level = impactNames[Math.min(impactNames.length - 1, Math.max(0, Math.round(s.avg_impact) - 1))] ?? ''
  const items = [
    { key: 'customers', color: '#9b87f5', big: `${s.unique_customers}`, text: 'customers affected, each counted once' },
    { key: 'impact', color: '#e3c04a', big: level, text: 'how badly a typical customer is hit' },
    { key: 'money', color: '#36c2cf', big: share(s.money_share), text: 'of complaints report money lost' },
    { key: 'anger', color: '#a3d13b', big: share(s.angry_share), text: 'sound angry (counts only a little)' },
    { key: 'trend', color: '#b8bcc4', big: s.trend > 1 ? 'Rising' : 'Steady', text: s.trend > 1 ? 'more customers this week than last' : 'no jump this week' },
  ]
  return (
    <div className="swhy">
      <span className="swhy__title">Why it ranks here</span>
      <ul className="swhy__list">
        {items.map((i) => (
          <li key={i.key} style={{ ['--c' as string]: i.color }}>
            <i aria-hidden="true" />
            <b>{i.big.charAt(0).toUpperCase() + i.big.slice(1)}</b>
            <span>{i.text}</span>
          </li>
        ))}
      </ul>
      <ScoreMap formula={s.formula} compact />
    </div>
  )
}
