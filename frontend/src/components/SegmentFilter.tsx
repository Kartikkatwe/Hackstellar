import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Users, X, Check } from 'lucide-react'
import { useApi } from '../lib/api'
import { useFilters } from '../lib/filters'
import { segmentValue } from '../lib/format'
import type { Config } from '../lib/types'
import './Popover.css'

/* Built entirely from GET /config, so a telecom pack brings its own groups with no UI change. */
export function SegmentFilter() {
  const { data: config } = useApi<Config>('/config')
  const { filters, set, clear } = useFilters()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = Object.entries(filters)
  const label = active.length ? active.map(([, v]) => segmentValue(v)).join(' · ') : 'All customers'

  return (
    <div className="pop" ref={ref}>
      <button className={`btn btn--sm${active.length ? ' is-filtered' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <Users size={15} />
        <span className="pop__btn-label">{label}</span>
        {active.length > 0 && (
          <span
            className="pop__clear"
            role="button"
            tabIndex={0}
            aria-label="Clear customer group filter"
            onClick={(e) => {
              e.stopPropagation()
              clear()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                clear()
              }
            }}
          >
            <X size={13} />
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && config && (
          <motion.div
            className="pop__panel"
            role="dialog"
            aria-label="Filter by customer group"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="pop__head">
              <strong>Customer group</strong>
              <span className="muted">Re-ranks the Top 10 for just these customers</span>
            </div>
            {config.segments.map((seg) => (
              <div key={seg.key} className="pop__group">
                <span className="label">{seg.label}</span>
                <div className="pop__chips">
                  <button className="chip" aria-pressed={!filters[seg.key]} onClick={() => set(seg.key, null)}>
                    Any
                  </button>
                  {seg.values.map((v) => {
                    const val = String(v)
                    const on = filters[seg.key] === val
                    return (
                      <button key={val} className="chip" aria-pressed={on} onClick={() => set(seg.key, on ? null : val)}>
                        {on && <Check size={13} />}
                        {segmentValue(v)}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            {active.length > 0 && (
              <button className="btn btn--sm btn--ghost pop__reset" onClick={clear}>
                Show all customers
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
