import { Inbox, Users, Zap, CircleCheck } from 'lucide-react'
import './NumberKey.css'

/* The key to the number colours. Every important number on the console wears one of four
   colours by what kind of number it is, never by whether it went up or down.
   Why an icon beside each colour: the key must read without colour too. */

export const NUMBER_KINDS = [
  { cls: 'n-volume', name: 'Volume', what: 'complaints and counts', Icon: Inbox },
  { cls: 'n-harm', name: 'Customer harm', what: 'people hurt, money lost, anger', Icon: Users },
  { cls: 'n-save', name: 'Speed and savings', what: 'LLM avoided, cost, time', Icon: Zap },
  { cls: 'n-right', name: 'Accuracy', what: 'checked against the answer key', Icon: CircleCheck },
] as const

export function NumberKey({ only, compact = false }: { only?: ('n-volume' | 'n-harm' | 'n-save' | 'n-right')[]; compact?: boolean }) {
  const kinds = only ? NUMBER_KINDS.filter((k) => only.includes(k.cls)) : NUMBER_KINDS
  return (
    <div className={`nkey${compact ? ' nkey--compact' : ''}`} role="note" aria-label="What the number colours mean">
      <span className="nkey__title">Number colours</span>
      <ul className="nkey__list">
        {kinds.map(({ cls, name, what, Icon }) => (
          <li key={cls} className={`nkey__item nkey__item--${cls}`}>
            <span className="nkey__dot" aria-hidden="true">
              <Icon size={12} strokeWidth={2.2} />
            </span>
            <span className="nkey__text">
              <strong className={cls}>{name}</strong>
              {!compact && <span>{what}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
