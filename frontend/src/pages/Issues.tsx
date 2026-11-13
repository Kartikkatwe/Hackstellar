import { Link, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { ArrowUpRight } from 'lucide-react'
import { useApi } from '../lib/api'
import { useFilters } from '../lib/filters'
import type { TopResponse, Channel } from '../lib/types'
import { componentName, segmentValue } from '../lib/format'
import { CHANNEL, CHANNELS } from '../lib/meta'
import { BadgePill, Flags, SegBar, Skeleton, Empty } from '../components/ui'
import { ScoreMap, ScoreKey } from '../components/ScoreMap'
import { NumberKey } from '../components/NumberKey'
import './Issues.css'

export default function Issues() {
  const reduce = useReducedMotion()
  const { query, filters } = useFilters()
  // "Every issue" lives in the URL (?all=1), so the view survives a reload or a shared link.
  const [params, setParams] = useSearchParams()
  const n: 10 | 50 = params.get('all') ? 50 : 10
  const setN = (v: 10 | 50) => setParams(v === 50 ? { all: '1' } : {}, { replace: true })
  const path = `/issues/top?${n === 50 ? 'n=50' : ''}${query ? `${n === 50 ? '&' : ''}${query}` : ''}`.replace(/\?$/, '')
  const { data, error } = useApi<TopResponse>(path, 4000)
  const group = Object.values(filters).map(segmentValue).join(' · ')
  const issues = data?.issues ?? []
  const max = Math.max(1, ...issues.map((i) => i.score))

  return (
    <div className="issues">
      <header className="phead">
        <div>
          <h1>{group ? `Top issues for ${group}` : 'Top issues'}</h1>
          <p>Ranked by a score anyone can check with a calculator. Each colour bar shows what drives the score; hover for the exact numbers, or open an issue for the full formula.</p>
        </div>
        <div className="phead__right">
          <div className="seg" role="group" aria-label="How many issues">
            <button aria-pressed={n === 10} onClick={() => setN(10)}>
              Top 10
            </button>
            <button aria-pressed={n === 50} onClick={() => setN(50)}>
              Every issue
            </button>
          </div>
        </div>
      </header>

      <NumberKey only={['n-volume', 'n-harm']} />
      <div className="issues__keys">
        <div className="issues__key">
          <span className="issues__keyname">Left bar: what drives the score</span>
          <ScoreKey />
        </div>
        <div className="issues__key">
          <span className="issues__keyname">Right bar: channels</span>
          <div className="issues__legend" aria-hidden="true">
            {CHANNELS.map((c) => (
              <span key={c}>
                <i style={{ background: CHANNEL[c].color }} />
                {CHANNEL[c].label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {error && !data && <Empty title="Could not load issues">{error}</Empty>}
      {!data && !error && <Skeleton h={600} />}

      <ol className="issues__list">
        <AnimatePresence initial={false}>
          {issues.map((i, idx) => (
            <motion.li
              key={i.issue_id}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 34, delay: reduce ? 0 : Math.min(idx, 10) * 0.03 }}
            >
              <Link to={`/console/issues/${i.issue_id}`} className="irow">
                <span className="irow__rank num">{i.rank}</span>
                <div className="irow__main">
                  <div className="irow__meta">
                    <span>{componentName(i.component)}</span>
                    {i.origin === 'discovered' && <span className="irow__found">Found by the engine</span>}
                    <Flags flags={i.flags} labels />
                  </div>
                  <h2 className="irow__title">{i.title}</h2>
                  <ScoreMap formula={i.formula} compact />
                </div>
                <div className="irow__side">
                  <div className="irow__nums">
                    <span>
                      <strong className="num n-harm">{i.unique_customers}</strong> customers
                    </span>
                    <span>
                      <strong className="num n-volume">{i.complaints}</strong> complaints
                    </span>
                  </div>
                  <SegBar
                    label="Complaints by channel"
                    parts={CHANNELS.map((c: Channel) => ({ key: c, name: CHANNEL[c].label, value: i.channels[c] ?? 0, color: CHANNEL[c].color }))}
                  />
                  <div className="irow__score">
                    <span className="irow__bar" aria-hidden="true">
                      <span style={{ width: `${(i.score / max) * 100}%` }} />
                    </span>
                    <BadgePill badge={i.badge} />
                  </div>
                </div>
                <ArrowUpRight size={18} className="irow__go" aria-hidden="true" />
              </Link>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  )
}
