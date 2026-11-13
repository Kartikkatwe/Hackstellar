import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowLeft } from 'lucide-react'
import { useApi } from '../lib/api'
import type { Channel, IssueDetail as Detail, Stage, Config } from '../lib/types'
import { componentName, int, pct, when } from '../lib/format'
import { CHANNEL, CHANNELS, STAGE, STAGE_ORDER } from '../lib/meta'
import { AnimatedNumber, BadgePill, ChannelIcon, ChannelTag, Empty, Flags, SegBar, Skeleton } from '../components/ui'
import { ScoreWhy } from '../components/ScoreWhy'
import { NumberKey } from '../components/NumberKey'
import { TrendChart } from '../components/TrendChart'
import './IssueDetail.css'

const ORDER_STATUS: Record<string, string> = {
  none: 'No order ID',
  verified: 'Order ID verified',
  failed_check: 'Order ID failed check',
  other_account: 'Order ID belongs to another account',
}

export default function IssueDetail() {
  const reduce = useReducedMotion()
  const { id } = useParams()
  const { data, error } = useApi<Detail>(`/issues/${id}`, 5000)
  const { data: config } = useApi<Config>('/config')
  const [tab, setTab] = useState<Channel | 'all'>('all')

  const complaints = useMemo(() => {
    const list = (data?.complaints ?? []).slice().reverse()
    return tab === 'all' ? list : list.filter((c) => c.channel === tab)
  }, [data, tab])

  if (error && !data) return <Empty title="Could not load this issue">{error}</Empty>
  if (!data)
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <Skeleton h={28} w={240} />
        <Skeleton h={60} w="70%" />
        <Skeleton h={300} />
      </div>
    )

  const s = data.summary
  const impactNames = config?.impact_levels.map((l) => l.split(':')[0]) ?? ['Annoyed', 'Inconvenienced', 'Blocked', 'Harmed']
  const mixTotal = Object.values(data.impact_mix).reduce((a, b) => a + b, 0) || 1

  return (
    <div className="idet">
      <Link to="/console/issues" className="idet__back">
        <ArrowLeft size={16} /> Top issues
      </Link>

      <header className="idet__head">
        <div className="idet__meta">
          <span className="idet__rank num">#{s.rank}</span>
          <span>{componentName(s.component)}</span>
          <BadgePill badge={s.badge} />
          <Flags flags={s.flags} labels />
          {s.origin === 'discovered' && <span className="idet__found">Found by the engine, named by the LLM</span>}
        </div>
        <motion.h1 initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
          {s.title}
        </motion.h1>
        {s.description && <p className="idet__desc">{s.description}</p>}
        <ScoreWhy s={s} />
      </header>

      <NumberKey only={['n-volume', 'n-harm']} />
      <section className="idet__stats" aria-label="Key numbers">
        <div>
          <span className="label">Unique customers</span>
          <strong className="n-harm">
            <AnimatedNumber value={s.unique_customers} />
          </strong>
          <span className="idet__sub">counted once across channels</span>
        </div>
        <div>
          <span className="label">Complaints</span>
          <strong className="n-volume">
            <AnimatedNumber value={s.complaints} />
          </strong>
          <span className="idet__sub">{s.unlinked_mentions} from people not yet linked</span>
        </div>
        <div>
          <span className="label">This week vs last</span>
          <strong className="n-harm">
            {s.customers_last_7d} <span className="idet__vs">vs {s.customers_prior_7d}</span>
          </strong>
          <span className="idet__sub">{s.trend > 1 ? 'Rising: trend × 1.25' : 'Not rising'}</span>
        </div>
        <div>
          <span className="label">Money lost</span>
          <strong className="n-harm">{s.money_share >= 0.5 ? 'Yes' : 'No'}</strong>
          <span className="idet__sub">{pct(s.money_share, 0)} of complaints report it</span>
        </div>
        <div>
          <span className="label">Angry</span>
          <strong className="n-harm">{pct(s.angry_share, 0)}</strong>
          <span className="idet__sub">of complaints</span>
        </div>
      </section>

      <div className="idet__grid">
        <section className="panel" aria-labelledby="trend-h">
          <div className="panel__head">
            <h2 id="trend-h" className="panel__title">
              Complaints per day
            </h2>
          </div>
          <div className="panel__body">
            <TrendChart daily={data.daily} />
          </div>
          <div className="panel__body idet__bars">
            <div>
              <span className="label">By channel</span>
              <SegBar height={10} label="Complaints by channel" parts={CHANNELS.map((c) => ({ key: c, name: CHANNEL[c].label, value: s.channels[c] ?? 0, color: CHANNEL[c].color }))} />
              <div className="idet__legend">
                {CHANNELS.filter((c) => s.channels[c]).map((c) => (
                  <ChannelTag key={c} channel={c} count={s.channels[c]} />
                ))}
              </div>
            </div>
            <div>
              <span className="label">Which check filed them</span>
              <SegBar
                height={10}
                label="Complaints by the stage that filed them"
                parts={STAGE_ORDER.filter((st) => s.settled_at[st]).map((st) => ({ key: st, name: STAGE[st].short, value: s.settled_at[st] ?? 0, color: STAGE[st].color }))}
              />
              <div className="idet__legend">
                {STAGE_ORDER.filter((st) => s.settled_at[st]).map((st) => (
                  <span key={st} className="idet__key">
                    <i style={{ background: STAGE[st].color }} />
                    {STAGE[st].short} <span className="num">{s.settled_at[st]}</span>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <span className="label">How badly it hurt</span>
              <div className="idet__impact">
                {[0, 1, 2, 3].map((k) => {
                  const n = data.impact_mix[String(k)] ?? 0
                  return (
                    <div key={k} className="idet__impact-row">
                      <span>{impactNames[k]}</span>
                      <span className="idet__impact-bar">
                        <span style={{ width: `${(n / mixTotal) * 100}%`, opacity: 0.35 + k * 0.2 }} />
                      </span>
                      <span className="num mono">{n}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="once-h">
          <div className="panel__head">
            <div>
              <h2 id="once-h" className="panel__title">
                Counted once
              </h2>
              <p className="idet__panel-sub">The same customer on several channels is one customer, not several.</p>
            </div>
          </div>
          <div className="panel__body">
            {data.repeat_customers.length === 0 ? (
              <Empty title="No repeat customers on this issue" />
            ) : (
              <ul className="once">
                {data.repeat_customers.slice(0, 6).map((r) => (
                  <li key={r.customer_id} className="once__item">
                    <div className="once__who">
                      <span className="once__avatar" aria-hidden="true">
                        {r.name
                          .split(' ')
                          .map((w) => w[0])
                          .join('')
                          .slice(0, 2)}
                      </span>
                      <div>
                        <strong>{r.name}</strong>
                        <span className="mono">{r.customer_id}</span>
                      </div>
                      <span className="once__count">
                        {r.contacts.length} contacts → <b>1</b>
                      </span>
                    </div>
                    <div className="once__paths" aria-label={`Contacted on ${r.channels.join(', ')}`}>
                      {r.contacts.map((c) => (
                        <span key={c.id} className="once__contact" style={{ ['--c' as string]: CHANNEL[c.channel].color }} title={c.text}>
                          <ChannelIcon channel={c.channel} size={13} />
                          {when(c.created_at)}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="panel" aria-labelledby="words-h">
        <div className="panel__head idet__words-head">
          <div>
            <h2 id="words-h" className="panel__title">
              {int(s.complaints)} complaints, one problem
            </h2>
            <p className="idet__panel-sub">Different words, channels and languages, filed under the same issue.</p>
          </div>
          <div className="seg" role="group" aria-label="Filter by channel">
            <button aria-pressed={tab === 'all'} onClick={() => setTab('all')}>
              All
            </button>
            {CHANNELS.filter((c) => s.channels[c]).map((c) => (
              <button key={c} aria-pressed={tab === c} onClick={() => setTab(c)}>
                {CHANNEL[c].label}
              </button>
            ))}
          </div>
        </div>
        <ul className="panel__body words">
          {complaints.slice(0, 40).map((c) => (
            <li key={c.id} className={`words__item${c.id.startsWith('L-') ? ' is-live' : ''}`}>
              <div className="words__top">
                <ChannelTag channel={c.channel} />
                <span className="words__who">{c.customer_name ?? 'Not linked'}</span>
                {c.id.startsWith('L-') && <span className="words__live">Sent live</span>}
                <span className="words__when">{when(c.created_at)}</span>
              </div>
              <p>{c.text}</p>
              <div className="words__foot">
                <span>
                  <i style={{ background: STAGE[c.stage as Stage]?.color }} />
                  {STAGE[c.stage as Stage]?.short ?? c.stage}
                  {c.similarity != null && c.stage === 'match' && <span className="mono"> · similarity {c.similarity.toFixed(2)}</span>}
                  {c.confidence != null && <span className="mono"> · {Math.round(c.confidence * 100)}% sure</span>}
                </span>
                <span>{ORDER_STATUS[c.order_status] ?? c.order_status}</span>
                <span className="mono words__id">{c.id}</span>
              </div>
            </li>
          ))}
        </ul>
        {complaints.length > 40 && <p className="idet__more">Showing the newest 40 of {complaints.length}.</p>}
      </section>
    </div>
  )
}
