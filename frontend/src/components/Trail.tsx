import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { UserRound, ShieldCheck, Waypoints, CheckCheck, Sparkles, Flag, ArrowUpRight, AlertTriangle } from 'lucide-react'
import type { Config, Trail as TrailT, Stage } from '../lib/types'
import { componentName, seconds, usd } from '../lib/format'
import { modelName } from '../lib/meta'
import { useApi } from '../lib/api'
import './Trail.css'

/* One complaint's path through the funnel, replayed from what the backend recorded.
   Why a replay: the API answers once, at the end; we then reveal each step in order, paced by
   the real latencies, so the audience sees the order of decisions without anything invented.
   Every number on this card comes from the response: probabilities, latency, cost, issue. */

type Step = {
  key: string
  name: string
  who: string
  icon: React.ReactNode
  status: 'pass' | 'settled' | 'skipped'
  verdict: string
  detail?: React.ReactNode
  latency?: number
  cost?: number
}

const LINK_METHOD: Record<string, string> = {
  chat_login: 'chat login',
  sender_email: 'sender email',
  caller_number: 'caller number',
  linked_handle: 'linked social handle',
  order_id: 'verified order ID',
  manual: 'linked by staff',
  unlinked: 'not linked',
}

function level(list: string[] | undefined, v: number) {
  if (!list?.length) return v.toFixed(1)
  const i = Math.max(0, Math.min(list.length - 1, Math.round(v)))
  return list[i].split(':')[0]
}

export function buildSteps(t: TrailT, config?: Config): Step[] {
  const settled = t.complaint.settled as Stage
  const ev = (s: string) => t.events.filter((e) => e.stage === s)
  const sum = (list: typeof t.events, k: 'latency_s' | 'cost_usd') => list.reduce((a, e) => a + (e[k] ?? 0), 0)
  const gate = t.gate
  const gateEv = ev('gate')
  const verEv = ev('verify')
  const llmEv = ev('llm')
  const probs: Record<string, number> = gate ? JSON.parse(gate.probs || '{}') : {}
  const filed = t.filed_under

  const steps: Step[] = [
    {
      key: 'who',
      name: 'Who sent this',
      who: 'Identity',
      icon: <UserRound size={16} />,
      status: 'pass',
      verdict: t.complaint.customer_id ? `Customer ${t.complaint.customer_id}, by ${LINK_METHOD[t.complaint.link_method] ?? t.complaint.link_method}` : 'Not linked to a customer yet; still counts towards its issue',
      detail: t.complaint.order_id ? <span className="mono">Order {t.complaint.order_id} · {t.complaint.order_status.replace(/_/g, ' ')}</span> : undefined,
    },
    {
      key: 'gate',
      name: 'Gate',
      who: gateEv[0] ? modelName(gateEv[0].model) : 'Jev',
      icon: <ShieldCheck size={16} />,
      status: settled === 'dropped' ? 'settled' : 'pass',
      verdict: gate
        ? settled === 'dropped'
          ? `Not a complaint (${Math.round(gate.is_complaint * 100)}% likely to be one). Dropped.`
          : `A complaint (${Math.round(gate.is_complaint * 100)}% sure), about ${componentName(gate.component)}`
        : 'No gate record',
      detail: gate && settled !== 'dropped' && (
        <div className="trail__gate">
          <div className="trail__probs">
            {Object.entries(probs)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([k, v]) => (
                <div key={k} className="trail__prob">
                  <span>{componentName(k)}</span>
                  <span className="trail__prob-bar">
                    <span style={{ width: `${v * 100}%` }} />
                  </span>
                  <span className="mono">{Math.round(v * 100)}%</span>
                </div>
              ))}
          </div>
          <div className="trail__chips">
            <span>Impact: {level(config?.impact_levels, gate.impact)}</span>
            <span>Mood: {level(config?.emotion_levels, gate.emotion)}</span>
            <span className={gate.money_lost >= 0.5 ? 'is-hot' : ''}>Money lost {Math.round(gate.money_lost * 100)}%</span>
            <span className={gate.legal_risk >= 0.5 ? 'is-hot' : ''}>Legal risk {Math.round(gate.legal_risk * 100)}%</span>
          </div>
        </div>
      ),
      latency: sum(gateEv, 'latency_s'),
      cost: sum(gateEv, 'cost_usd'),
    },
    {
      key: 'match',
      name: 'Similarity',
      who: 'Local, free',
      icon: <Waypoints size={16} />,
      status: settled === 'dropped' ? 'skipped' : settled === 'match' ? 'settled' : 'pass',
      verdict:
        settled === 'dropped'
          ? 'Not reached'
          : settled === 'match'
            ? `Very close to a known issue${filed?.similarity != null ? ` (similarity ${filed.similarity.toFixed(2)})` : ''}`
            : verEv.length
              ? 'Close to some issues but not sure: asked Jev'
              : 'Like nothing known: no issue close enough',
    },
    {
      key: 'verify',
      name: 'Verify',
      who: verEv[0] ? modelName(verEv[0].model) : 'Jev',
      icon: <CheckCheck size={16} />,
      status: settled === 'verify' ? 'settled' : verEv.length ? 'pass' : 'skipped',
      verdict:
        settled === 'verify'
          ? `Yes: same problem as a known issue${filed?.confidence != null ? ` (${Math.round(filed.confidence * 100)}% sure)` : ''}`
          : verEv.length
            ? `${verEv.length} yes/no question${verEv.length > 1 ? 's' : ''}, no confident yes`
            : 'Not needed',
      latency: sum(verEv, 'latency_s') || undefined,
      cost: sum(verEv, 'cost_usd') || undefined,
    },
    {
      key: 'llm',
      name: 'LLM',
      who: llmEv[0] ? modelName(llmEv[0].model) : 'Claude Haiku 5.5',
      icon: <Sparkles size={16} />,
      status: settled === 'llm' ? 'settled' : llmEv.length ? 'pass' : 'skipped',
      verdict: settled === 'llm' ? 'Decided which issue it belongs to' : llmEv.length ? 'Judged it a new problem' : 'Not needed: no LLM call',
      latency: sum(llmEv, 'latency_s') || undefined,
      cost: sum(llmEv, 'cost_usd') || undefined,
    },
  ]
  return steps
}

export function TrailView({ trail, mode, warning, replay = true }: { trail: TrailT; mode?: 'live' | 'offline'; warning?: string | null; replay?: boolean }) {
  const reduce = useReducedMotion()
  const { data: config } = useApi<Config>('/config')
  const steps = useMemo(() => buildSteps(trail, config), [trail, config])
  const settled = trail.complaint.settled as Stage
  const totalLatency = trail.events.reduce((a, e) => a + e.latency_s, 0)
  const totalCost = trail.events.reduce((a, e) => a + e.cost_usd, 0)
  const llmCalls = trail.events.filter((e) => e.stage === 'llm').length
  const [shown, setShown] = useState(replay && !reduce ? 0 : steps.length + 1)

  // Pace the replay by the real latencies, squeezed into roughly two seconds.
  useEffect(() => {
    if (!replay || reduce) {
      setShown(steps.length + 1)
      return
    }
    setShown(0)
    const real = steps.map((s) => (s.status === 'skipped' ? 0.05 : Math.max(0.12, s.latency ?? 0.08)))
    const total = real.reduce((a, b) => a + b, 0)
    const scale = Math.min(1, 2.2 / total)
    let acc = 150
    const timers = steps.map((_, i) => {
      acc += real[i] * 1000 * scale + 160
      return window.setTimeout(() => setShown(i + 1), acc)
    })
    timers.push(window.setTimeout(() => setShown(steps.length + 1), acc + 380))
    return () => timers.forEach(clearTimeout)
  }, [trail.complaint.id, replay, reduce, steps])

  const outcome =
    settled === 'dropped'
      ? { title: 'Dropped at the gate', text: 'Praise, spam or a question: kept out of the counts.', tone: 'muted' }
      : settled === 'pending'
        ? { title: trail.complaint.urgent ? 'Waiting list, flagged urgent' : 'Waiting list', text: trail.complaint.urgent ? 'Matches nothing known yet, and money or safety is at risk, so staff see it now.' : 'Matches nothing known yet. Two more customers with the same problem make it an issue.', tone: trail.complaint.urgent ? 'urgent' : 'muted' }
        : settled === 'new_issue'
          ? { title: 'Became a new issue', text: 'Three different customers reported the same new problem.', tone: 'brass' }
          : { title: 'Filed under', text: trail.filed_under?.title ?? 'a known issue', tone: 'brass' }

  return (
    <div className="trail">
      {mode && (
        <div className={`trail__mode trail__mode--${mode}`} role="status">
          {mode === 'live' ? (
            <>
              <span className="trail__mode-dot" /> Live models: Jev and Claude Haiku decided this
            </>
          ) : (
            <>
              <AlertTriangle size={15} /> Processed offline with stand-in models. Results are less reliable.
            </>
          )}
          {warning && <span className="trail__warn">{warning}</span>}
        </div>
      )}

      <blockquote className="trail__quote">
        <p>{trail.complaint.text}</p>
        <footer className="mono">
          {trail.complaint.id} · {trail.complaint.channel}
        </footer>
      </blockquote>

      <ol className="trail__steps">
        {steps.map((s, i) => {
          const visible = i < shown
          return (
            <motion.li
              key={s.key}
              className={`trail__step is-${s.status}${visible ? ' is-in' : ''}`}
              initial={false}
              animate={{ opacity: visible ? (s.status === 'skipped' ? 0.45 : 1) : 0.18 }}
              transition={{ duration: 0.3 }}
            >
              <span className="trail__node" aria-hidden="true">
                {s.icon}
              </span>
              <div className="trail__body">
                <div className="trail__head">
                  <strong>{s.name}</strong>
                  <span className="trail__who">{s.who}</span>
                  {visible && s.latency != null && s.status !== 'skipped' && (
                    <span className="trail__cost mono">
                      {seconds(s.latency)} · {usd(s.cost ?? 0, 5)}
                    </span>
                  )}
                </div>
                <p className="trail__verdict">{visible ? s.verdict : '…'}</p>
                {visible && s.detail && <div className="trail__detail">{s.detail}</div>}
              </div>
              {s.status === 'settled' && visible && <span className="trail__settled">Settled here</span>}
            </motion.li>
          )
        })}
      </ol>

      <motion.div
        className={`trail__out trail__out--${outcome.tone}`}
        initial={false}
        animate={{ opacity: shown > steps.length ? 1 : 0, y: shown > steps.length ? 0 : 8 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <Flag size={18} aria-hidden="true" />
        <div>
          <span className="trail__out-title">{outcome.title}</span>
          <span className="trail__out-text">{outcome.text}</span>
        </div>
        {trail.filed_under && (
          <Link to={`/console/issues/${trail.filed_under.issue_id}`} className="btn btn--sm">
            Open issue <ArrowUpRight size={14} />
          </Link>
        )}
      </motion.div>

      <dl className="trail__totals">
        <div>
          <dt>Time in models</dt>
          <dd className="mono">{seconds(totalLatency)}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd className="mono">{usd(totalCost, 5)}</dd>
        </div>
        <div>
          <dt>LLM calls</dt>
          <dd className="mono">{llmCalls}</dd>
        </div>
      </dl>
    </div>
  )
}
