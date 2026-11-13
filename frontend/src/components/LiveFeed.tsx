import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useApi } from '../lib/api'
import type { ComplaintRow } from '../lib/types'
import { STAGE } from '../lib/meta'
import { ago } from '../lib/format'
import { ChannelTag, Empty } from './ui'
import './LiveFeed.css'

/* Latest arrivals, polled every 2 s. Anything that arrives while you watch slides in on top with
   a brass edge: that is the judge's phone complaint landing. */
export function LiveFeed({ limit = 7 }: { limit?: number }) {
  const reduce = useReducedMotion()
  const { data, mode } = useApi<ComplaintRow[]>(`/complaints?limit=${limit}`, 2000)
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [, tick] = useState(0)

  useEffect(() => {
    if (!data) return
    if (!seen.current) {
      seen.current = new Set(data.map((d) => d.id))
      return
    }
    const arrived = data.filter((d) => !seen.current!.has(d.id)).map((d) => d.id)
    if (arrived.length) {
      arrived.forEach((id) => seen.current!.add(id))
      setFresh((f) => new Set([...f, ...arrived]))
    }
  }, [data])

  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 20000)
    return () => window.clearInterval(t)
  }, [])

  if (!data) return <Empty title="Waiting for the feed…" />
  return (
    <ul className="feed" aria-live="polite" aria-relevant="additions">
      <AnimatePresence initial={false}>
        {data.map((c) => {
          const isNew = fresh.has(c.id)
          return (
            <motion.li
              key={c.id}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: -18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className={`feed__item${isNew ? ' is-new' : ''}`}
            >
              <Link to={`/console/live?trail=${encodeURIComponent(c.id)}`} className="feed__link">
                <div className="feed__top">
                  <ChannelTag channel={c.channel} />
                  {isNew && <span className="feed__new">Just arrived</span>}
                  <span className="feed__when">{mode === 'snapshot' ? c.created_at.slice(5, 16).replace('T', ' ') : ago(c.created_at)}</span>
                </div>
                <p className="feed__text">{c.text}</p>
                <div className="feed__stage">
                  <span className="feed__pip" style={{ background: STAGE[c.settled]?.color }} aria-hidden="true" />
                  {STAGE[c.settled]?.label ?? c.settled}
                  {c.urgent ? <span className="feed__urgent">Urgent</span> : null}
                  <span className="feed__id mono">{c.id}</span>
                </div>
              </Link>
            </motion.li>
          )
        })}
      </AnimatePresence>
    </ul>
  )
}
