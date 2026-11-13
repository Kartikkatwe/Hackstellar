import type { Badge, Channel, Flag, Stage } from './types'

/* Fixed identities. Colour follows the entity, never its rank (dataviz rule), and every
   colour ships with a label or an icon so nothing is read by colour alone. */

export const CHANNELS: Channel[] = ['email', 'call', 'chat', 'social']

export const CHANNEL: Record<Channel, { label: string; color: string }> = {
  email: { label: 'Email', color: 'var(--ch-email)' },
  call: { label: 'Call', color: 'var(--ch-call)' },
  chat: { label: 'Chat', color: 'var(--ch-chat)' },
  social: { label: 'Social', color: 'var(--ch-social)' },
}

export const STAGE: Record<Stage, { label: string; short: string; color: string; what: string }> = {
  dropped: { label: 'Dropped at the gate', short: 'Dropped', color: 'var(--st-dropped)', what: 'Not a complaint: praise, spam or a question' },
  match: { label: 'Similarity match', short: 'Match', color: 'var(--st-match)', what: 'Very close to a known issue, filed for free' },
  verify: { label: 'Verified by Jev', short: 'Verify', color: 'var(--st-verify)', what: 'Jev answered yes to "same problem as issue X?"' },
  llm: { label: 'Settled by the LLM', short: 'LLM', color: 'var(--st-llm)', what: 'The few the cheap checks could not decide' },
  new_issue: { label: 'Became a new issue', short: 'New issue', color: 'var(--st-new)', what: 'Three different customers reported the same new thing' },
  pending: { label: 'Waiting for more reports', short: 'Waiting', color: 'var(--st-pending)', what: 'Unconfirmed: matches nothing known yet' },
}

export const STAGE_ORDER: Stage[] = ['dropped', 'match', 'verify', 'llm', 'new_issue', 'pending']

export const BADGE: Record<Badge, { color: string; rank: number }> = {
  Critical: { color: 'var(--critical)', rank: 0 },
  High: { color: 'var(--serious)', rank: 1 },
  Medium: { color: 'var(--warning)', rank: 2 },
  Low: { color: 'var(--good)', rank: 3 },
}

export const FLAG: Record<Flag, { label: string; hint: string }> = {
  money: { label: 'Money lost', hint: 'Half or more of these complaints report money lost' },
  legal: { label: 'Legal or safety risk', hint: 'Legal or safety risk in 5% or more of complaints' },
  angry: { label: 'Angry customers', hint: 'A large share of these customers are angry' },
  rising: { label: 'Rising', hint: 'More customers this week than the week before' },
}

/** Short model names for the trail. */
export function modelName(m: string) {
  if (m.includes('jev')) return 'Jev 1.14'
  if (m.includes('haiku')) return 'Claude Haiku 5.5'
  if (m.includes('sonnet')) return 'Claude Sonnet 5.5'
  if (m.includes('MiniLM') || m.includes('hybrid')) return 'Local similarity'
  return m
}
