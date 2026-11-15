import { motion, useReducedMotion } from 'motion/react'
import './Formula.css'

/* The ranking is plain arithmetic and the API returns it as a string:
   "52 customers x 3.69 impact x 2.00 money x 1.14 anger x 1.25 trend = 547.3".
   We split that exact string, never recompute it, so the UI cannot disagree with the backend. */

export function parseFormula(s: string) {
  const [lhs, rhs] = s.split('=')
  const factors = (lhs ?? '')
    .split(/\s+x\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^([\d.,]+)\s*(.*)$/)
      return m ? { value: m[1], name: m[2] } : { value: part, name: '' }
    })
  return { factors, result: (rhs ?? '').trim() }
}

// customers, impact, money and anger say how much it hurts; the score is what ranks it
const KIND: Record<string, string> = { customers: 'n-harm', impact: 'n-harm', money: 'n-harm', anger: 'n-harm' }

const HINT: Record<string, string> = {
  customers: 'Unique customers, counted once across channels',
  impact: 'Average impact, 1 annoyed to 4 harmed',
  money: '1 + share of complaints reporting money lost',
  anger: '1 + 0.25 × share of angry complaints',
  trend: '1.25 when more customers this week than last',
}

export function Formula({ formula, size = 'md', animate = true }: { formula: string; size?: 'sm' | 'md' | 'lg'; animate?: boolean }) {
  const reduce = useReducedMotion()
  const { factors, result } = parseFormula(formula)
  const anim = animate && !reduce
  return (
    <div className={`formula formula--${size}`} aria-label={`Score: ${formula.replace(/ x /g, ' times ')}`}>
      {factors.map((f, i) => (
        <motion.span
          key={`${f.name}-${i}`}
          className="formula__f"
          title={HINT[f.name] ?? f.name}
          initial={anim ? { opacity: 0, y: 8 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 * i, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          {i > 0 && (
            <span className="formula__x" aria-hidden="true">
              ×
            </span>
          )}
          <span className="formula__stack">
            <span className={`formula__v ${KIND[f.name] ?? ''}`}>{f.value}</span>
            <span className="formula__n">{f.name}</span>
          </span>
        </motion.span>
      ))}
      <motion.span
        className="formula__eq"
        initial={anim ? { opacity: 0, scale: 0.9 } : false}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.08 * factors.length + 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <span className="formula__x" aria-hidden="true">
          =
        </span>
        <span className="formula__stack">
          <span className="formula__v formula__v--result">{result}</span>
          <span className="formula__n">score</span>
        </span>
      </motion.span>
    </div>
  )
}
