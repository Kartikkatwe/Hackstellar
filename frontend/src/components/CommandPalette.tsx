import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Search, CornerDownLeft, Compass, ListOrdered, Radio, Filter, Grid3x3, Hourglass, Target, Home, Smartphone } from 'lucide-react'
import { useApi } from '../lib/api'
import { componentName } from '../lib/format'
import type { TopResponse } from '../lib/types'
import { BadgePill } from './ui'
import './Palette.css'

type Item = { id: string; group: string; label: string; hint?: string; icon?: React.ReactNode; badge?: React.ReactNode; run: () => void }

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const { data: all } = useApi<TopResponse>(open ? '/issues/top?n=50' : null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      setTimeout(() => input.current?.focus(), 20)
    }
  }, [open])

  const items: Item[] = useMemo(() => {
    const go = (to: string) => () => {
      nav(to)
      onClose()
    }
    const pages: Item[] = [
      { id: 'p-home', group: 'Pages', label: 'Product page', icon: <Home size={16} />, run: () => window.location.assign('/') },
      { id: 'p-ov', group: 'Pages', label: 'Overview', icon: <Compass size={16} />, run: go('/console') },
      { id: 'p-top', group: 'Pages', label: 'Top issues', icon: <ListOrdered size={16} />, run: go('/console/issues') },
      { id: 'p-live', group: 'Pages', label: 'Live intake: send a complaint', icon: <Radio size={16} />, run: go('/console/live') },
      { id: 'p-fun', group: 'Pages', label: 'Funnel and cost', icon: <Filter size={16} />, run: go('/console/funnel') },
      { id: 'p-seg', group: 'Pages', label: 'Customer groups', icon: <Grid3x3 size={16} />, run: go('/console/segments') },
      { id: 'p-wait', group: 'Pages', label: 'Unconfirmed reports', icon: <Hourglass size={16} />, run: go('/console/waiting') },
      { id: 'p-acc', group: 'Pages', label: 'Accuracy', icon: <Target size={16} />, run: go('/console/accuracy') },
      { id: 'p-phone', group: 'Pages', label: 'Phone complaint form', icon: <Smartphone size={16} />, run: go('/submit') },
    ]
    const issues: Item[] = (all?.issues ?? []).map((i) => ({
      id: `i-${i.issue_id}`,
      group: 'Issues',
      label: i.title,
      hint: `#${i.rank} · ${componentName(i.component)} · ${i.unique_customers} customers`,
      badge: <BadgePill badge={i.badge} size="sm" />,
      run: go(`/console/issues/${i.issue_id}`),
    }))
    const all2 = [...pages, ...issues]
    const needle = q.trim().toLowerCase()
    if (!needle) return all2
    return all2.filter((it) => `${it.label} ${it.hint ?? ''}`.toLowerCase().includes(needle))
  }, [all, q, nav, onClose])

  useEffect(() => setSel(0), [q])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(items.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[sel]?.run()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  let lastGroup = ''
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="palette" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            className="palette__card"
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="palette__search">
              <Search size={18} aria-hidden="true" />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
                placeholder="Search issues and pages…"
                aria-label="Search issues and pages"
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={items[sel] ? `pi-${items[sel].id}` : undefined}
              />
              <kbd>esc</kbd>
            </div>
            <div className="palette__list" id="palette-list" role="listbox" ref={list}>
              {items.length === 0 && <p className="palette__none">Nothing matches “{q}”.</p>}
              {items.map((it, i) => {
                const head = it.group !== lastGroup ? it.group : null
                lastGroup = it.group
                return (
                  <div key={it.id}>
                    {head && <div className="palette__group">{head}</div>}
                    <button
                      id={`pi-${it.id}`}
                      data-i={i}
                      role="option"
                      aria-selected={i === sel}
                      className={`palette__item${i === sel ? ' is-sel' : ''}`}
                      onMouseMove={() => setSel(i)}
                      onClick={it.run}
                    >
                      {it.icon && <span className="palette__icon">{it.icon}</span>}
                      <span className="palette__label">
                        {it.label}
                        {it.hint && <span className="palette__hint">{it.hint}</span>}
                      </span>
                      {it.badge}
                      {i === sel && <CornerDownLeft size={14} className="palette__enter" aria-hidden="true" />}
                    </button>
                  </div>
                )
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
