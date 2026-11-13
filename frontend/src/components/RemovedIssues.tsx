import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { restoreIssue, useApi } from '../lib/api'
import { componentName } from '../lib/format'
import './RemoveIssue.css'

type Removed = { issues: { id: number; title: string; component: string; reason: string | null; complaints: number }[] }

/** Issues staff removed, each with Restore. Shown under Top issues; hidden when there are none. */
export function RemovedIssues() {
  const { data } = useApi<Removed>('/removed-issues', 5000)
  const [busy, setBusy] = useState<number | null>(null)
  if (!data?.issues.length) return null
  return (
    <section className="rmvd" aria-label="Removed by staff">
      <h2>Removed by staff</h2>
      <ul>
        {data.issues.map((i) => (
          <li key={i.id}>
            <div className="rmvd__t">
              <b>{i.title}</b>
              <span>
                {componentName(i.component)} · {i.complaints} complaints · {i.reason ?? 'Removed by staff'}
              </span>
            </div>
            <button
              className="btn btn--sm"
              disabled={busy === i.id}
              onClick={async () => {
                setBusy(i.id)
                try {
                  await restoreIssue(i.id)
                } finally {
                  setBusy(null)
                }
              }}
            >
              <RotateCcw size={14} /> {busy === i.id ? 'Restoring…' : 'Restore'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
