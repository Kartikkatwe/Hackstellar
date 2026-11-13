import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, Send } from 'lucide-react'
import { useApi, useConnection } from '../lib/api'
import { useFilters } from '../lib/filters'
import type { Accuracy, Config, Cost, Funnel, TopResponse } from '../lib/types'
import { componentName, scoreScale, segmentValue, usd } from '../lib/format'
import { CompassDial } from '../components/CompassDial'
import { FunnelFlow } from '../components/FunnelFlow'
import { ScoreMap } from '../components/ScoreMap'
import { TopList } from '../components/TopList'
import { LiveFeed } from '../components/LiveFeed'
import { NumberKey } from '../components/NumberKey'
import { AnimatedNumber, BadgePill, Flags, LiveDot, SegBar, Skeleton } from '../components/ui'
import './Overview.css'

export default function Overview() {
  const reduce = useReducedMotion()
  const conn = useConnection()
  const { filters, query } = useFilters()
  const { data: config } = useApi<Config>('/config')
  const { data: funnel } = useApi<Funnel>('/funnel', 2500)
  const topPath = `/issues/top${query ? `?${query}` : ''}`
  const { data: top } = useApi<TopResponse>(topPath, 4000)
  const { data: all, error: allErr } = useApi<TopResponse>(`/issues/top?n=50${query ? `&${query}` : ''}`, 8000)
  const { data: allPlain } = useApi<TopResponse>(allErr ? '/issues/top?n=50' : null)
  const { data: cost } = useApi<Cost>('/cost', 15000)
  const { data: acc } = useApi<Accuracy>('/accuracy', 30000)
  const [focusId, setFocusId] = useState<number | null>(null)
  const onFocus = useCallback((id: number | null) => setFocusId(id), [])

  const issues = top?.issues ?? []
  const allIssues = (all ?? allPlain)?.issues ?? []
  const components = useMemo(() => Object.keys(config?.components ?? {}), [config])
  const totals = useMemo(() => {
    const t: Record<string, number> = {}
    allIssues.forEach((i) => (t[i.component] = (t[i.component] ?? 0) + i.complaints))
    return t
  }, [allIssues])

  const focus = issues.find((i) => i.issue_id === focusId) ?? issues[0]
  const haiku = cost?.baseline.models.find((m) => m.model.includes('haiku'))
  const reached = funnel ? Math.round(funnel.total * (1 - funnel.share_without_llm)) : 0
  const avgSec = cost && funnel ? cost.funnel.seconds / Math.max(1, funnel.run.n || funnel.total) : null
  const baseSec = cost && funnel ? cost.baseline.seconds / Math.max(1, funnel.run.n || funnel.total) : null
  const groupLabel = Object.values(filters).map(segmentValue).join(' · ')
  const pct1 = useCallback((n: number) => `${n.toFixed(1)}%`, [])
  const usd2 = useCallback((n: number) => usd(n, 2), [])
  const x1 = useCallback((n: number) => `${n.toFixed(1)}×`, [])

  return (
    <div className="ov">
      {/* ---------- hero: the reduction, and the compass ---------- */}
      <section className="ov__hero" aria-labelledby="ov-title">
        <div className="ov__lede">
          <p className="ov__eyebrow">
            <LiveDot mode={conn.mode} />
            {config ? `${config.business} · ${config.domain}` : 'Loading the business…'}
            {groupLabel && <span className="ov__group">Showing {groupLabel}</span>}
          </p>
          <h1 id="ov-title" className="ov__title">
            <motion.span className="ov__line" initial={reduce ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
              <AnimatedNumber value={funnel?.total} className="n-volume" /> complaints.
            </motion.span>
            <motion.span className="ov__line ov__line--2" initial={reduce ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}>
              <AnimatedNumber value={allIssues.length || undefined} className="n-volume" /> issues.
            </motion.span>
            <motion.span className="ov__line ov__line--3" initial={reduce ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}>
              One to fix first.
            </motion.span>
          </h1>

          <div className="ov__focus" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              {focus ? (
                <motion.div
                  key={focus.issue_id}
                  initial={reduce ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, y: -6, transition: { duration: 0.12 } }}
                  transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="ov__focus-meta">
                    <span className="ov__rank num">#{focus.rank}</span>
                    <span>{componentName(focus.component)}</span>
                    <BadgePill badge={focus.badge} />
                    <Flags flags={focus.flags} />
                  </div>
                  <h2 className="ov__focus-title">{focus.title}</h2>
                  <ScoreMap key={focus.issue_id} formula={focus.formula} scale={scoreScale(Math.max(0, ...(allIssues.length ? allIssues : issues).map((i) => i.score)))} />
                </motion.div>
              ) : (
                <div className="ov__focus-skel">
                  <Skeleton h={18} w={220} />
                  <Skeleton h={34} w="90%" />
                  <Skeleton h={28} w="80%" />
                </div>
              )}
            </AnimatePresence>
          </div>

          <div className="ov__cta">
            {focus && (
              <Link to={`/console/issues/${focus.issue_id}`} className="btn btn--primary btn--lg">
                Open this issue <ArrowRight size={17} />
              </Link>
            )}
            <Link to="/console/live" className="btn btn--lg">
              <Send size={16} /> Send a complaint
            </Link>
          </div>
        </div>

        <div className="ov__dial">
          {components.length > 0 && issues.length > 0 ? (
            <CompassDial issues={issues} components={components} componentTotals={totals} focusId={focusId} onFocus={onFocus} />
          ) : (
            <div className="ov__dial-skel" />
          )}
          <p className="ov__dial-note">
            Further out means a higher score. Point at an issue and the needle follows.
          </p>
        </div>
      </section>

      {/* ---------- proof tiles ---------- */}
      <NumberKey />
      <section className="ov__tiles" aria-label="Measured results">
        <article className="tile">
          <span className="label">Never waited on an LLM</span>
          <span className="tile__value">
            <AnimatedNumber value={funnel ? funnel.share_without_llm * 100 : undefined} format={pct1} className="n-save" />
          </span>
          <SegBar
            label="Complaints settled without an LLM versus with one"
            parts={[
              { key: 'no', name: 'Settled without an LLM', value: funnel ? funnel.total - reached : 0, color: 'var(--brass)' },
              { key: 'yes', name: 'Reached the LLM', value: reached, color: 'var(--st-llm)' },
            ]}
          />
          <span className="tile__sub">{funnel ? `${reached} of ${funnel.total.toLocaleString('en-IN')} reached one` : ' '}</span>
        </article>
        <article className="tile">
          <span className="label">Filed under the right issue</span>
          <span className="tile__value">
            <AnimatedNumber value={acc?.issue.accuracy_pct} format={pct1} className="n-right" />
          </span>
          <SegBar
            label="Correct versus wrong filings"
            parts={[
              { key: 'ok', name: 'Correct', value: acc?.issue.correct ?? 0, color: 'var(--good)' },
              { key: 'bad', name: 'Wrong', value: acc ? acc.issue.assigned - acc.issue.correct : 0, color: 'var(--critical)' },
            ]}
          />
          <span className="tile__sub">{acc ? `of ${acc.issue.assigned.toLocaleString('en-IN')} checked against the answer key` : ' '}</span>
        </article>
        <article className="tile">
          <span className="label">Cost per 100,000 complaints</span>
          <span className="tile__value">
            <AnimatedNumber value={cost?.funnel.per_100k_usd} format={usd2} className="n-save" />
          </span>
          <div className="tile__bars" aria-hidden="true">
            <span style={{ width: haiku ? `${(cost!.funnel.per_100k_usd / haiku.per_100k_usd) * 100}%` : 0 }} className="is-us" />
            <span style={{ width: '100%' }} />
          </div>
          <span className="tile__sub">{haiku ? `Claude Haiku on every complaint: ${usd(haiku.per_100k_usd, 2)}` : ' '}</span>
        </article>
        <article className="tile">
          <span className="label">Faster than one LLM call each</span>
          <span className="tile__value">
            <AnimatedNumber value={cost?.speedup} format={x1} className="n-save" />
          </span>
          <div className="tile__bars" aria-hidden="true">
            <span style={{ width: avgSec && baseSec ? `${(avgSec / baseSec) * 100}%` : 0 }} className="is-us" />
            <span style={{ width: '100%' }} />
          </div>
          <span className="tile__sub">{avgSec && baseSec ? `${avgSec.toFixed(2)} s a complaint, against ${baseSec.toFixed(1)} s per LLM call` : ' '}</span>
        </article>
      </section>

      {/* ---------- the funnel ---------- */}
      <section className="panel ov__flow" aria-labelledby="ov-flow">
        <div className="panel__head">
          <div>
            <h2 id="ov-flow" className="panel__title">
              Where every complaint settled
            </h2>
            <p className="ov__panel-sub">Cheapest check first. Each one settles what it can and passes the rest on.</p>
          </div>
          <Link to="/console/funnel" className="btn btn--sm btn--ghost">
            Funnel and cost <ArrowRight size={15} />
          </Link>
        </div>
        <div className="panel__body">{funnel ? <FunnelFlow funnel={funnel} /> : <Skeleton h={360} />}</div>
      </section>

      {/* ---------- ranked + live ---------- */}
      <div className="ov__split">
        <section className="panel" aria-labelledby="ov-top">
          <div className="panel__head">
            <div>
              <h2 id="ov-top" className="panel__title">
                Top 10 {groupLabel ? `for ${groupLabel}` : 'issues'}
              </h2>
              <p className="ov__panel-sub">Unique customers × impact × money × anger × trend.</p>
            </div>
            <Link to="/console/issues" className="btn btn--sm btn--ghost">
              All issues <ArrowRight size={15} />
            </Link>
          </div>
          <div className="panel__body ov__toplist">
            {top ? <TopList issues={issues} focusId={focusId} onFocus={onFocus} /> : <Skeleton h={480} />}
          </div>
        </section>

        <section className="panel" aria-labelledby="ov-feed">
          <div className="panel__head">
            <div>
              <h2 id="ov-feed" className="panel__title ov__feed-title">
                <LiveDot mode={conn.mode} /> Arriving now
              </h2>
              <p className="ov__panel-sub">The newest complaints and where each one settled.</p>
            </div>
            <Link to="/console/live" className="btn btn--sm btn--ghost">
              Live intake <ArrowRight size={15} />
            </Link>
          </div>
          <div className="panel__body">
            <LiveFeed limit={6} />
          </div>
        </section>
      </div>
    </div>
  )
}
