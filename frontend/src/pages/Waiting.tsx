import { useMemo, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { AlertOctagon } from 'lucide-react'
import { useApi } from '../lib/api'
import type { Config, PendingItem } from '../lib/types'
import { componentName, when } from '../lib/format'
import { ChannelTag, Empty, Meter, Skeleton, YesNo } from '../components/ui'
import './Waiting.css'

/* Unconfirmed reports: complaints that match no known issue yet. A pattern becomes an issue
   once 3 different customers report it; one report with money lost or a safety risk is urgent now. */
export default function Waiting() {
  const reduce = useReducedMotion()
  const { data, error } = useApi<PendingItem[]>('/pending', 3000)
  const { data: config } = useApi<Config>('/config')
  const [comp, setComp] = useState<string | null>(null)
  const list = useMemo(() => (data ?? []).filter((p) => !comp || p.component === comp), [data, comp])
  const comps = useMemo(() => Array.from(new Set((data ?? []).map((p) => p.component))), [data])
  const urgent = (data ?? []).filter((p) => p.urgent).length
  const need = (config?.thresholds?.new_issue_customers as number | undefined) ?? 3

  return (
    <div className="wait">
      <header className="phead">
        <div>
          <h1>Unconfirmed reports</h1>
          <p>
            These match no known issue yet. When {need} different customers report the same new thing it becomes a ranked issue. {urgent > 0 && <strong className="wait__urgent-n">{urgent} urgent</strong>}
            {urgent > 0 && ' because money or safety is at risk.'}
          </p>
        </div>
        <div className="phead__right">
          <div className="wait__chips">
            <button className="chip" aria-pressed={!comp} onClick={() => setComp(null)}>
              All
            </button>
            {comps.map((c) => (
              <button key={c} className="chip" aria-pressed={comp === c} onClick={() => setComp(comp === c ? null : c)}>
                {componentName(c)}
              </button>
            ))}
          </div>
        </div>
      </header>

      {error && !data && <Empty title="Could not load the waiting list">{error}</Empty>}
      {!data && !error && <Skeleton h={400} />}
      {data && list.length === 0 && <Empty title="Nothing waiting">Every complaint matched a known issue.</Empty>}

      <ul className="wait__list">
        <AnimatePresence initial={false}>
          {list.map((p, i) => (
            <motion.li
              key={p.id}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: reduce ? 0 : Math.min(i, 12) * 0.025 }}
              className={`wcard${p.urgent ? ' is-urgent' : ''}`}
            >
              <div className="wcard__top">
                <ChannelTag channel={p.channel} />
                <span className="wcard__comp">{componentName(p.component)}</span>
                {p.urgent ? (
                  <span className="wcard__flag">
                    <AlertOctagon size={14} /> Urgent
                  </span>
                ) : null}
                <span className="wcard__when">{when(p.created_at)}</span>
              </div>
              <p className="wcard__text">{p.text}</p>
              <div className="wcard__meters">
                <div>
                  <span>Impact</span>
                  <Meter value={p.impact} max={3} color="var(--serious)" label="Impact" />
                </div>
                <div>
                  <span className="wcard__yn">
                    Money lost <YesNo yes={p.money_lost >= 0.5} title={`Jev: ${Math.round(p.money_lost * 100)}% likely`} />
                  </span>
                  <Meter value={p.money_lost} color="var(--brass)" label="Money lost likelihood" />
                </div>
                <div>
                  <span>Legal risk</span>
                  <Meter value={p.legal_risk} color="var(--critical)" label="Legal or safety risk likelihood" />
                </div>
              </div>
              <div className="wcard__foot">
                <span className="mono">{p.id}</span>
                <span>{p.customer_id ? `Customer ${p.customer_id}` : 'Not linked to a customer'}</span>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  )
}
