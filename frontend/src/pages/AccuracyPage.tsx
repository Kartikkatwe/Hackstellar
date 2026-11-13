import { CheckCircle2 } from 'lucide-react'
import { useApi } from '../lib/api'
import type { Accuracy } from '../lib/types'
import { int, pctRaw } from '../lib/format'
import { AnimatedNumber, Empty, Skeleton } from '../components/ui'
import { NumberKey } from '../components/NumberKey'
import './AccuracyPage.css'

/* Measured, not claimed: the mock data records each complaint's true issue, the engine never
   sees it, and this page scores the engine against it. The caveat is printed, not hidden. */

function Ring({ value, label }: { value: number; label: string }) {
  const r = 52
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 132 132" className="ring" role="img" aria-label={`${label}: ${value.toFixed(1)}%`}>
      <circle cx="66" cy="66" r={r} className="ring__track" />
      <circle cx="66" cy="66" r={r} className="ring__fill" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
    </svg>
  )
}

export default function AccuracyPage() {
  const { data: acc, error } = useApi<Accuracy>('/accuracy', 30000)
  const pct1 = (n: number) => `${n.toFixed(1)}%`
  if (error && !acc) return <Empty title="No accuracy data">{error}</Empty>
  if (!acc) return <Skeleton h={600} />
  if (acc.note) return <Empty title="No answer key for this business">{acc.note}</Empty>

  const big = [
    { label: 'Filed under the right issue', value: acc.issue.accuracy_pct, sub: `${int(acc.issue.correct)} of ${int(acc.issue.assigned)} filed complaints` },
    { label: 'Real complaints kept by the gate', value: acc.gate.complaint_recall_pct, sub: `${acc.gate.wrongly_dropped} of ${int(acc.gate.real_complaints)} wrongly dropped` },
    { label: 'Praise, spam and questions removed', value: acc.gate.noise_removed_pct, sub: `${acc.gate.non_complaints_let_through} of ${acc.gate.non_complaints} let through` },
    { label: 'Sent to the right part of the business', value: acc.component_accuracy_pct, sub: 'Payments, delivery, refunds…' },
    { label: 'Customer links correct', value: acc.identity.link_accuracy_pct, sub: `${int(acc.identity.linked)} linked, ${acc.identity.wrong_links} wrong, ${int(acc.identity.unlinked)} left unlinked on purpose` },
  ]

  return (
    <div className="accp">
      <header className="phead">
        <div>
          <h1>Measured against an answer key</h1>
          <p>Every mock complaint records its true issue. The engine never sees it; this page scores the engine against it.</p>
        </div>
      </header>

      <NumberKey only={['n-right', 'n-volume']} />
      <section className="accp__grid" aria-label="Accuracy">
        {big.map((b) => (
          <article key={b.label} className="accp__card">
            <div className="accp__ring">
              <Ring value={b.value} label={b.label} />
              <strong className="n-right">
                <AnimatedNumber value={b.value} format={pct1} />
              </strong>
            </div>
            <div>
              <h2>{b.label}</h2>
              <p>{b.sub}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="panel" aria-labelledby="disc-h">
        <div className="panel__head">
          <div>
            <h2 id="disc-h" className="panel__title">
              Hidden problems found: <span className="n-right">{acc.discovered.hidden_issues_found} of {acc.discovered.hidden_issues_in_data}</span>
            </h2>
            <p className="accp__sub">Five problems were planted in the data with no name and no seed. The engine found them, grouped them and the LLM named them.</p>
          </div>
        </div>
        <div className="panel__body">
          <table className="table">
            <thead>
              <tr>
                <th>Named by the LLM</th>
                <th>Planted as</th>
                <th className="r">Complaints</th>
                <th className="r">Pure</th>
              </tr>
            </thead>
            <tbody>
              {acc.discovered.issues.map((d) => (
                <tr key={d.key}>
                  <td className="accp__title">
                    <CheckCircle2 size={15} aria-hidden="true" /> {d.title}
                  </td>
                  <td className="mono accp__key">{d.true_issue}</td>
                  <td className="r n-volume">{d.size}</td>
                  <td className="r n-right">{pctRaw(d.purity_pct, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="accp__caveat">
        <h2>What these numbers do not say</h2>
        <ul>
          <li>The data is template-generated with a fixed seed. Real complaints are messier.</li>
          <li>Cut-offs were tuned on the same data they are scored on.</li>
          <li>One planted problem came out as two issues (“rude” and “demands extra payment”); the Curator judged them different.</li>
          <li>
            {acc.issue.still_waiting['new issue, not yet recurring'] ?? 0} complaints are still waiting for a second and third customer; {acc.issue.still_waiting['known issue, should have matched'] ?? 0} should have matched a known issue.
          </li>
        </ul>
      </section>
    </div>
  )
}
