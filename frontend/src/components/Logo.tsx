import { useId } from 'react'
import './Logo.css'

/* The mark: an open ring (the "C") with a brass needle breaking out through the gap.
   Why: many complaints in, one direction out. The ring also reads as a gauge, and the pitch is speed.
   Why the needle is drawn pointing up and rotated: one rotate() animates the settle.
   Not: a 4-segment ring (one per channel); it read as a loading spinner at 16px (see comps). */

type Props = {
  size?: number
  animate?: boolean
  wordmark?: boolean
  className?: string
  /** angle of the needle in degrees, 0 = north; the brand angle is 45 */
  angle?: number
}

export function LogoMark({ size = 32, animate = false, angle = 45 }: Omit<Props, 'wordmark' | 'className'>) {
  const id = useId().replace(/:/g, '')
  return (
    <svg
      className={`cc-mark${animate ? ' cc-mark--animate' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      style={{ ['--needle' as string]: `${angle}deg` }}
    >
      <defs>
        <linearGradient id={`b${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#9c7434" />
          <stop offset=".55" stopColor="#d9b26b" />
          <stop offset="1" stopColor="#f6e3b8" />
        </linearGradient>
      </defs>
      <path
        className="cc-mark__ring"
        d="M56.15 25.53 A25 25 0 1 1 38.47 7.85"
        pathLength={1}
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <g className="cc-mark__needle">
        <path d="M32 2 L39 32 L32 32 Z" fill={`url(#b${id})`} />
        <path d="M32 2 L25 32 L32 32 Z" fill="#f6e3b8" />
        <path d="M32 46 L25 32 L32 32 Z" fill="#3b3933" />
        <path d="M32 46 L39 32 L32 32 Z" fill="#2a2925" />
        <circle cx="32" cy="32" r="2.6" fill="#0a0a0b" stroke="#f6e3b8" strokeWidth="1.4" />
      </g>
    </svg>
  )
}

export function Logo({ size = 28, animate = false, wordmark = true, className = '' }: Props) {
  return (
    <span className={`cc-logo ${className}`}>
      <LogoMark size={size} animate={animate} />
      {wordmark && (
        <span className="cc-logo__word" translate="no" style={{ fontSize: Math.round(size * 0.54) }}>
          Complaint Compass
        </span>
      )}
    </span>
  )
}
