import { Meters, FACTORS } from './Meters'
import './ScoreWhy.css'

/* Why an issue ranks where it does, in plain words for people who have never seen the formula.
   Why (13 Nov): judges read "3.72 impact x 2.00 money x 1.12 anger" as noise. Customers and
   trend stay plain words; severity, money lost and anger are gauges filled up to their cut-off.
   The exact formula stays in the API (transparency is kept). */

type Summary = {
  unique_customers: number
  avg_impact: number
  money_share: number
  angry_share: number
  trend: number
  formula: string
}

export function ScoreWhy({ s }: { s: Summary }) {
  const items = [
    { key: 'customers', color: FACTORS.customers.color, big: `${s.unique_customers}`, text: 'customers affected, each counted once' },
    { key: 'trend', color: FACTORS.trend.color, big: s.trend > 1 ? 'Rising' : 'Steady', text: s.trend > 1 ? 'more customers this week than last' : 'no jump this week' },
  ]
  return (
    <div className="swhy">
            <ul className="swhy__list">
        {items.map((i) => (
          <li key={i.key} style={{ ['--c' as string]: i.color }}>
            <i aria-hidden="true" />
            <b>{i.big.charAt(0).toUpperCase() + i.big.slice(1)}</b>
            <span>{i.text}</span>
          </li>
        ))}
      </ul>
      <Meters s={s} />
    </div>
  )
}
