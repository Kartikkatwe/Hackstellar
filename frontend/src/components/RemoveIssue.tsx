import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { removeIssue } from '../lib/api'
import './RemoveIssue.css'

/* Staff take an issue off the list (fixed, wrong, or a test). Soft: Top issues can restore it.
   Why a confirm step with an optional reason: it is one click from the projector, and the
   reason goes on record beside the issue. */
export function RemoveIssue({ id, title }: { id: number; title: string }) {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open)
    return (
      <button className="btn btn--sm rmv__open" onClick={() => setOpen(true)}>
        <Trash2 size={14} /> Remove issue
      </button>
    )

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      await removeIssue(id, reason)
      nav('/console/issues')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="rmv" role="dialog" aria-label="Remove this issue">
      <p className="rmv__q">
        Remove <b>{title}</b> from the list?
      </p>
      <p className="rmv__sub">Its complaints keep their history. New complaints like it go to the waiting list. You can restore it from Top issues.</p>
      <input
        className="rmv__in"
        placeholder="Reason (optional), e.g. fixed in app 4.2"
        value={reason}
        maxLength={300}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !busy && go()}
        autoFocus
      />
      {error && <p className="rmv__err">{error}</p>}
      <div className="rmv__btns">
        <button className="btn btn--sm rmv__yes" onClick={go} disabled={busy}>
          <Trash2 size={14} /> {busy ? 'Removing…' : 'Remove'}
        </button>
        <button className="btn btn--sm btn--ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  )
}
