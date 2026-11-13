import { useEffect, useRef, useState, type ReactNode } from 'react'
import { animate, useReducedMotion } from 'motion/react'
import { AtSign, Mail, MessageCircle, Phone, IndianRupee, Scale, Flame, TrendingUp, AlertTriangle, AlertOctagon, ChevronUp, Circle } from 'lucide-react'
import type { Badge as BadgeT, Channel, Flag } from '../lib/types'
import { BADGE, CHANNEL, FLAG } from '../lib/meta'
import './ui.css'

/* Small shared pieces. One badge, one flag, one channel tag: one system. */

export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString('en-IN'),
  duration = 1.1,
  className = '',
  flash = true,
}: {
  value: number | undefined | null
  format?: (n: number) => string
  duration?: number
  className?: string
  flash?: boolean
}) {
  // Why textContent instead of state: 60 updates a second should not re-render React.
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef<number | null>(null)
  const reduce = useReducedMotion()
  const [pulse, setPulse] = useState(0)
  useEffect(() => {
    if (value == null || !ref.current) return
    const from = prev.current ?? 0
    const first = prev.current == null
    prev.current = value
    if (reduce || from === value) {
      ref.current.textContent = format(value)
      return
    }
    if (!first && flash) setPulse((p) => p + 1)
    const ctl = animate(from, value, {
      duration: first ? duration : 0.8,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = format(v)
      },
    })
    return () => ctl.stop()
  }, [value, reduce, duration, format, flash])
  return (
    <span className={`anum ${className}`}>
      <span ref={ref}>{value == null ? '–' : format(0)}</span>
      {pulse > 0 && <span key={pulse} className="anum__flash" aria-hidden="true" />}
    </span>
  )
}

export function ChannelIcon({ channel, size = 16 }: { channel: Channel; size?: number }) {
  const p = { size, strokeWidth: 1.75, 'aria-hidden': true as const }
  if (channel === 'email') return <Mail {...p} />
  if (channel === 'call') return <Phone {...p} />
  if (channel === 'chat') return <MessageCircle {...p} />
  return <AtSign {...p} />
}

export function ChannelTag({ channel, count }: { channel: Channel; count?: number }) {
  return (
    <span className="ctag" style={{ ['--c' as string]: CHANNEL[channel].color }}>
      <span className="ctag__dot" aria-hidden="true">
        <ChannelIcon channel={channel} size={12} />
      </span>
      {CHANNEL[channel].label}
      {count != null && <span className="ctag__n num">{count}</span>}
    </span>
  )
}

export function BadgePill({ badge, size = 'md' }: { badge: BadgeT; size?: 'sm' | 'md' }) {
  const Icon = badge === 'Critical' ? AlertOctagon : badge === 'High' ? AlertTriangle : badge === 'Medium' ? ChevronUp : Circle
  return (
    <span className={`badge badge--${size}`} style={{ ['--b' as string]: BADGE[badge].color }}>
      <Icon size={size === 'sm' ? 12 : 13} strokeWidth={2.2} aria-hidden="true" />
      {badge}
    </span>
  )
}

export function FlagIcon({ flag, size = 14 }: { flag: Flag; size?: number }) {
  const p = { size, strokeWidth: 1.9, 'aria-hidden': true as const }
  if (flag === 'money') return <IndianRupee {...p} />
  if (flag === 'legal') return <Scale {...p} />
  if (flag === 'angry') return <Flame {...p} />
  return <TrendingUp {...p} />
}

export function Flags({ flags, labels = false }: { flags: Flag[]; labels?: boolean }) {
  if (!flags.length) return null
  return (
    <span className="flags">
      {flags.map((f) => (
        <span key={f} className={`flag flag--${f}`} title={FLAG[f].hint}>
          <FlagIcon flag={f} />
          {labels ? <span>{FLAG[f].label}</span> : <span className="sr-only">{FLAG[f].label}</span>}
        </span>
      ))}
    </span>
  )
}

/** Thin segmented bar: one whole split into parts (dataviz "thin segmented bar"). */
export function SegBar({ parts, height = 6, label }: { parts: { key: string; value: number; color: string; name: string }[]; height?: number; label: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1
  return (
    <div className="segbar" style={{ height }} role="img" aria-label={`${label}: ${parts.map((p) => `${p.name} ${p.value}`).join(', ')}`}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span key={p.key} style={{ flexGrow: p.value / total, background: p.color }} title={`${p.name}: ${p.value} (${Math.round((p.value / total) * 100)}%)`} />
        ))}
    </div>
  )
}

export function Meter({ value, max = 1, color = 'var(--brass)', label }: { value: number; max?: number; color?: string; label: string }) {
  const w = Math.max(0, Math.min(1, value / max))
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span style={{ width: `${w * 100}%`, background: color }} />
    </div>
  )
}

/** Money lost as a plain Yes/No. Why (13 Nov, Kartik): a percentage reads as noise to judges;
    the line is the same 50% cut-off the ranker and the urgent flag use. */
export function YesNo({ yes, title }: { yes: boolean; title?: string }) {
  return (
    <span className={`yn ${yes ? 'yn--yes' : 'yn--no'}`} title={title}>
      {yes ? 'Yes' : 'No'}
    </span>
  )
}

export function LiveDot({ mode }: { mode: 'live' | 'snapshot' | 'connecting' | undefined }) {
  return <span className={`livedot livedot--${mode ?? 'connecting'}`} aria-hidden="true" />
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {children && <div className="empty__body">{children}</div>}
    </div>
  )
}

export function Skeleton({ h = 16, w = '100%', r = 8 }: { h?: number; w?: number | string; r?: number }) {
  return <span className="skel" style={{ height: h, width: w, borderRadius: r }} aria-hidden="true" />
}
