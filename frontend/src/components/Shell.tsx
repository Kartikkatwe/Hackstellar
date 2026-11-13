import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Compass, ListOrdered, Radio, Filter, Grid3x3, Hourglass, Target, Search, Plus, Smartphone, Menu, X } from 'lucide-react'
import { Logo } from './Logo'
import { LiveDot } from './ui'
import { useApi, useConnection } from '../lib/api'
import type { Config, Funnel, Health, PendingItem } from '../lib/types'
import { SegmentFilter } from './SegmentFilter'
import { PhoneQR } from './PhoneQR'
import { CommandPalette } from './CommandPalette'
import './Shell.css'

const NAV = [
  { to: '/console', label: 'Overview', icon: Compass, end: true },
  { to: '/console/issues', label: 'Top issues', icon: ListOrdered },
  { to: '/console/live', label: 'Live intake', icon: Radio, live: true },
  { to: '/console/funnel', label: 'Funnel and cost', icon: Filter },
  { to: '/console/segments', label: 'Customer groups', icon: Grid3x3 },
  { to: '/console/waiting', label: 'Unconfirmed', icon: Hourglass, count: true },
  { to: '/console/accuracy', label: 'Accuracy', icon: Target },
]

export function Shell({ children }: { children: ReactNode }) {
  const loc = useLocation()
  const nav = useNavigate()
  const reduce = useReducedMotion()
  const conn = useConnection()
  const { data: config } = useApi<Config>('/config')
  const { data: funnel } = useApi<Funnel>('/funnel', 3000)
  const { data: pending } = useApi<PendingItem[]>('/pending', 8000)
  const { data: health } = useApi<Health>('/health', 10000)
  const [menu, setMenu] = useState(false)
  const [qr, setQr] = useState(false)
  const [palette, setPalette] = useState(false)

  useEffect(() => setMenu(false), [loc.pathname])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const urgent = pending?.filter((p) => p.urgent).length ?? 0
  const title = NAV.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)))?.label ?? 'Issue'

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className={`side${menu ? ' is-open' : ''}`} aria-label="Console">
        <div className="side__top">
          <Link to="/" className="side__logo" aria-label="Complaint Compass home">
            <Logo size={28} animate />
          </Link>
          <button className="side__close btn btn--ghost btn--sm" onClick={() => setMenu(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <div className="side__biz">
          <span className="side__biz-name">{config?.business ?? 'BasketNow'}</span>
          <span className="side__biz-dom">{config?.domain ?? 'Quick-commerce grocery delivery'}</span>
        </div>

        <nav className="side__nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `side__link${isActive ? ' is-active' : ''}`}>
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="side-active" className="side__active" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                  <n.icon size={18} strokeWidth={1.75} aria-hidden="true" />
                  <span>{n.label}</span>
                  {n.live && <LiveDot mode={conn.mode} />}
                  {n.count && pending && pending.length > 0 && (
                    <span className={`side__count${urgent ? ' is-urgent' : ''}`} title={`${pending.length} unconfirmed, ${urgent} urgent`}>
                      {pending.length}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <button className="side__phone" onClick={() => setQr(true)}>
          <span className="side__phone-icon">
            <Smartphone size={18} strokeWidth={1.75} />
          </span>
          <span>
            <strong>Complain from a phone</strong>
            <span>Scan, type, watch it land here</span>
          </span>
        </button>

        <div className="side__status" role="status" aria-live="polite">
          <LiveDot mode={conn.mode} />
          <span>
            {conn.mode === 'live' && (
              <>
                <strong>Live</strong> · API connected
                <br />
                {health?.live_complaints_use === 'live' ? 'New complaints use the real models' : 'New complaints use offline stand-ins'}
              </>
            )}
            {conn.mode === 'snapshot' && (
              <>
                <strong>Snapshot</strong> · API offline, showing the recorded live run
              </>
            )}
            {conn.mode === 'connecting' && <>Connecting to the API…</>}
          </span>
          {funnel && <span className="side__total num">{funnel.total.toLocaleString('en-IN')} complaints</span>}
        </div>
      </aside>

      <div className="main">
        <header className="top">
          <button className="top__menu btn btn--ghost btn--sm" onClick={() => setMenu(true)} aria-label="Open menu" aria-expanded={menu}>
            <Menu size={18} />
          </button>
          <div className="top__crumb">
            <span className="muted">{config?.business ?? 'BasketNow'}</span>
            <span className="top__sep" aria-hidden="true">
              /
            </span>
            <span>{title}</span>
          </div>
          <div className="top__actions">
            <SegmentFilter />
            <button className="btn btn--sm top__search" onClick={() => setPalette(true)} aria-label="Search issues and pages">
              <Search size={15} />
              <span className="top__search-label">Search</span>
              <kbd>⌘K</kbd>
            </button>
            <button className="btn btn--primary btn--sm" onClick={() => nav('/console/live')}>
              <Plus size={15} strokeWidth={2.2} />
              <span>New complaint</span>
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            id="main"
            key={loc.pathname}
            className="page"
            initial={reduce ? false : { opacity: 0, y: 14, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reduce ? undefined : { opacity: 0, y: -8, transition: { duration: 0.16 } }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.main>
        </AnimatePresence>
      </div>

      {menu && <div className="scrim" onClick={() => setMenu(false)} aria-hidden="true" />}
      <PhoneQR open={qr} onClose={() => setQr(false)} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  )
}
