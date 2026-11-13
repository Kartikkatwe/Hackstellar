import { useApi } from '../lib/api'
import type { Accuracy, Cost, Funnel } from '../lib/types'
import { int, pctRaw, seconds, usd } from '../lib/format'
import { modelName } from '../lib/meta'
import { FunnelFlow } from '../components/FunnelFlow'
import { AnimatedNumber, Skeleton } from '../components/ui'
import './FunnelCost.css'

const STAGE_NAME: Record<string, string> = {
  gate: 'Gate: is it a complaint, which area, how bad',
  verify: 'Verify: same problem as issue X?',
  llm: 'LLM: the few the cheap checks could not settle',
  verify_group: 'Group check before a new issue is made',
  llm_name: 'Naming newly found issues',
  llm_curate: 'Curator: merging duplicates',
}

type Bar = { name: string; value: number; us?: boolean; note?: string }

/* Two charts, not one: on a single axis Sonnet ($594) would flatten every other bar to nothing.
   Each chart is one axis, sorted, value at the bar tip (dataviz rules). */
function CostBars({ title, bars, unit }: { title: string; bars: Bar[]; unit: (n: number) => string }) {
  const max = Math.max(...bars.map((b) => b.value))
  return (
    <figure className="cbars">
      <figcaption className="cbars__title">{title}</figcaption>
      {bars.map((b) => (
        <div key={b.name} className={`cbars__row${b.us ? ' is-us' : ''}`}>
          <span className="cbars__name">
            {b.name}
            {b.note && <span>{b.note}</span>}
          </span>
          <span className="cbars__track">
            <span className="cbars__bar" style={{ width: `${Math.max(0.6, (b.value / max) * 100)}%` }} />
          </span>
          <span className="cbars__val mono">{unit(b.value)}</span>
        </div>
      ))}
    </figure>
  )
}

export default function FunnelCost() {
  const { data: funnel } = useApi<Funnel>('/funnel', 2500)
  const { data: cost } = useApi<Cost>('/cost', 8000)
  const { data: acc } = useApi<Accuracy>('/accuracy', 30000)
  const haiku = cost?.baseline.models.find((m) => m.model.includes('haiku'))
  const sonnet = cost?.baseline.models.find((m) => m.model.includes('sonnet'))
  const n = funnel?.run.n || funnel?.total || 1
  const usd2 = (v: number) => usd(v, 2)

  return (
    <div className="fc">
      <header className="phead">
        <div>
          <h1>Funnel and cost</h1>
          <p>
            Measured on the live run of {int(funnel?.run.n)} complaints with real Jev and Claude Haiku. The “LLM for every complaint” baseline is priced from real token counts; it was not run.
          </p>
        </div>
      </header>

      <section className="panel">
        <div className="panel__body">{funnel ? <FunnelFlow funnel={funnel} /> : <Skeleton h={420} />}</div>
      </section>

      <section className="fc__hero" aria-label="Headline numbers">
        <div>
          <span className="label">Cost of the whole run</span>
          <strong>
            <AnimatedNumber value={cost?.funnel.cost_usd} format={(v) => usd(v, 4)} />
          </strong>
          <span className="fc__sub">{haiku ? `Haiku on every complaint: ${usd(haiku.cost_usd, 3)}` : ''}</span>
        </div>
        <div>
          <span className="label">Saving against Claude Haiku</span>
          <strong>{haiku ? pctRaw(haiku.saving_pct) : '–'}</strong>
          <span className="fc__sub">{haiku ? `${pctRaw(haiku.saving_vs_cached_pct)} even if every call hit the cache` : ''}</span>
        </div>
        <div>
          <span className="label">Saving against Claude Sonnet</span>
          <strong>{sonnet ? pctRaw(sonnet.saving_pct) : '–'}</strong>
          <span className="fc__sub">{sonnet ? `${pctRaw(sonnet.saving_vs_cached_pct)} against the best cache` : ''}</span>
        </div>
        <div>
          <span className="label">Faster</span>
          <strong>{cost ? `${cost.speedup.toFixed(1)}×` : '–'}</strong>
          <span className="fc__sub">{cost ? `${(cost.funnel.seconds / n).toFixed(2)} s a complaint in models, against ${(cost.baseline.seconds / n).toFixed(1)} s` : ''}</span>
        </div>
      </section>

      {cost && haiku && sonnet && (
        <section className="panel" aria-labelledby="cmp-h">
          <div className="panel__head">
            <div>
              <h2 id="cmp-h" className="panel__title">
                Cost per 100,000 complaints
              </h2>
              <p className="fc__panel-sub">Our measured cost against sending every complaint to an LLM. Shorter is better.</p>
            </div>
          </div>
          <div className="panel__body fc__cmp">
            <CostBars
              title="Against Claude Haiku 5.5"
              unit={usd2}
              bars={[
                { name: 'Complaint Compass', value: cost.funnel.per_100k_usd, us: true, note: 'measured' },
                { name: 'Haiku, every call cached', value: haiku.per_100k_cached_usd, note: 'best case for the LLM' },
                { name: 'Haiku, no cache', value: haiku.per_100k_usd },
              ]}
            />
            <CostBars
              title="Against Claude Sonnet 5.5"
              unit={usd2}
              bars={[
                { name: 'Complaint Compass', value: cost.funnel.per_100k_usd, us: true, note: 'measured' },
                { name: 'Sonnet, every call cached', value: sonnet.per_100k_cached_usd, note: 'best case for the LLM' },
                { name: 'Sonnet, no cache', value: sonnet.per_100k_usd },
              ]}
            />
          </div>
          <p className="fc__note">{cost.baseline.note}</p>
        </section>
      )}

      <section className="panel" aria-labelledby="ledger-h">
        <div className="panel__head">
          <div>
            <h2 id="ledger-h" className="panel__title">
              Every model call, by stage
            </h2>
            <p className="fc__panel-sub">{cost?.note}</p>
          </div>
        </div>
        <div className="panel__body fc__table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Model</th>
                <th className="r">Calls</th>
                <th className="r">Tokens in</th>
                <th className="r">Tokens out</th>
                <th className="r">Seconds</th>
                <th className="r">Cost</th>
              </tr>
            </thead>
            <tbody>
              {cost?.funnel.stages.map((s) => (
                <tr key={s.stage}>
                  <td className="fc__stage">{STAGE_NAME[s.stage] ?? s.stage}</td>
                  <td>{modelName(s.model)}</td>
                  <td className="r">{int(s.calls)}</td>
                  <td className="r">{int(s.in_tokens)}</td>
                  <td className="r">{int(s.out_tokens)}</td>
                  <td className="r">{seconds(s.seconds)}</td>
                  <td className="r mono">{usd(s.cost_usd, 4)}</td>
                </tr>
              ))}
              {cost && (
                <tr className="fc__total">
                  <td>Total</td>
                  <td />
                  <td className="r">{int(cost.funnel.stages.reduce((a, s) => a + s.calls, 0))}</td>
                  <td className="r">{int(cost.funnel.stages.reduce((a, s) => a + s.in_tokens, 0))}</td>
                  <td className="r">{int(cost.funnel.stages.reduce((a, s) => a + s.out_tokens, 0))}</td>
                  <td className="r">{seconds(cost.funnel.seconds)}</td>
                  <td className="r mono">{usd(cost.funnel.cost_usd, 4)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {acc && (
        <section className="panel" aria-labelledby="stage-acc-h">
          <div className="panel__head">
            <div>
              <h2 id="stage-acc-h" className="panel__title">
                Cheap does not mean careless
              </h2>
              <p className="fc__panel-sub">Share filed under the right issue, by the check that filed it, against the answer key.</p>
            </div>
          </div>
          <div className="panel__body fc__acc">
            {(['match', 'verify', 'llm', 'new_issue'] as const).map((k) => {
              const s = acc.issue.by_stage[k]
              if (!s) return null
              return (
                <div key={k} className="fc__acc-item">
                  <span className="label">{{ match: 'Similarity match', verify: 'Verified by Jev', llm: 'Settled by the LLM', new_issue: 'New issues' }[k]}</span>
                  <strong>{pctRaw(s.accuracy_pct)}</strong>
                  <span className="fc__sub">of {int(s.n)} complaints</span>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
