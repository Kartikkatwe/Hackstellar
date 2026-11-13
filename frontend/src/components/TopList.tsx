import { Link } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { ArrowUpRight } from 'lucide-react'
import type { Issue } from '../lib/types'
import { componentName, scoreScale } from '../lib/format'
import { BadgePill, Flags } from './ui'
import './TopList.css'

/* Ranked list. Rows slide to their new place when a live complaint re-ranks them
   (motion layout), so a change in order is something you see happen. */
export function TopList({ issues, focusId, onFocus, maxScore }: { issues: Issue[]; focusId?: number | null; onFocus?: (id: number | null) => void; maxScore?: number }) {
  const reduce = useReducedMotion()
  const top = maxScore ?? Math.max(1, ...issues.map((i) => i.score))
  const scale = scoreScale(top)
  return (
    <ol className="toplist">
      <AnimatePresence initial={false}>
        {issues.map((i) => (
          <motion.li
            key={i.issue_id}
            layout={!reduce}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className={focusId === i.issue_id ? 'is-focus' : ''}
            onMouseEnter={() => onFocus?.(i.issue_id)}
            onMouseLeave={() => onFocus?.(null)}
          >
            <Link to={`/console/issues/${i.issue_id}`} className="toplist__row" onFocus={() => onFocus?.(i.issue_id)} onBlur={() => onFocus?.(null)}>
              <span className="toplist__rank num">{i.rank}</span>
              <span className="toplist__main">
                <span className="toplist__title">{i.title}</span>
                <span className="toplist__meta">
                  <span>{componentName(i.component)}</span>
                  {i.origin === 'discovered' && <span className="toplist__found">Found by the engine</span>}
                  <Flags flags={i.flags} />
                </span>
              </span>
              <span className="toplist__cust num" title="Unique customers">
                <b className="n-harm">{i.unique_customers}</b>
                <span>customers</span>
              </span>
              <span className="toplist__score">
                <span className="toplist__bar" aria-hidden="true">
                  <span style={{ width: `${(i.score / scale) * 100}%` }} />
                </span>
                <span className="num toplist__out">
                  {Math.round(i.score)}
                  <span>/{scale}</span>
                </span>
              </span>
              <BadgePill badge={i.badge} size="sm" />
              <ArrowUpRight size={16} className="toplist__go" aria-hidden="true" />
            </Link>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  )
}
