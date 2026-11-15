import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Send, Loader2, Smartphone, RotateCcw } from 'lucide-react'
import { getTrail, postComplaint, useApi, useConnection } from '../lib/api'
import type { Channel, LiveResult, NewComplaint, Trail, TopResponse } from '../lib/types'
import { CHANNEL, CHANNELS, STAGE } from '../lib/meta'
import { ChannelIcon } from '../components/ui'
import { TrailView } from '../components/Trail'
import { QRSvg, phoneUrl } from '../components/PhoneQR'
import './Live.css'

/* The live demo. A typed complaint goes to POST /complaints, runs through the real funnel
   (real Jev and Claude Haiku when the backend has its key), and comes back with its trail.
   Every other screen refreshes at once, so the Top 10 and the counters move while you watch. */

const SAMPLES = [
  { label: 'Hinglish: money gone', channel: 'chat' as Channel, text: 'paise kat gaye lekin order nahi bana, please check' },
  { label: 'Charged twice', channel: 'email' as Channel, text: 'I was charged twice for one order since I updated the app' },
  { label: 'Praise, not a complaint', channel: 'social' as Channel, text: 'Love the 10 minute delivery, great job team!' },
]

const ID_FIELD: Record<Channel, { key: keyof NewComplaint; label: string; placeholder: string; type: string }> = {
  chat: { key: 'user_id', label: 'Chat login', placeholder: 'u_10224…', type: 'text' },
  email: { key: 'email', label: 'Sender email', placeholder: 'name@example.com…', type: 'email' },
  social: { key: 'handle', label: 'Social handle', placeholder: '@handle…', type: 'text' },
  call: { key: 'phone', label: 'Caller number', placeholder: '+91 98xxx xxxxx…', type: 'tel' },
}

type Sent = { id: string; text: string; channel: Channel; settled: string; title: string | null; mode: string; at: number }

function readHistory(): Sent[] {
  try {
    return JSON.parse(sessionStorage.getItem('cc-sent') || '[]')
  } catch {
    return []
  }
}

export default function Live() {
  const conn = useConnection()
  const [params, setParams] = useSearchParams()
  const [channel, setChannel] = useState<Channel>('chat')
  const [text, setText] = useState('')
  const [ident, setIdent] = useState('')
  const [orderId, setOrderId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<LiveResult | null>(null)
  const [viewed, setViewed] = useState<Trail | null>(null)
  const [history, setHistory] = useState<Sent[]>(readHistory)
  const { data: all } = useApi<TopResponse>('/issues/top?n=50', result ? 3000 : 0)

  // ?trail=ID opens a recorded complaint's path (from the feed).
  const trailId = params.get('trail')
  useEffect(() => {
    if (!trailId) return
    setResult(null)
    getTrail(trailId)
      .then(({ data }) => setViewed(data))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [trailId])

  const field = ID_FIELD[channel]
  const filedNow = useMemo(() => {
    const id = result?.filed_under?.issue_id
    return id ? all?.issues.find((i) => i.issue_id === id) : undefined
  }, [all, result])

  async function send(e?: React.FormEvent) {
    e?.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    setViewed(null)
    if (trailId) setParams({}, { replace: true })
    try {
      const body: NewComplaint = { channel, text: text.trim() }
      if (ident.trim()) (body as unknown as Record<string, string>)[field.key] = ident.trim()
      if (orderId.trim()) body.order_id = orderId.trim().toUpperCase()
      const r = await postComplaint(body)
      setResult(r)
      const item: Sent = { id: r.complaint.id, text: r.complaint.text, channel, settled: r.result.settled, title: r.filed_under?.title ?? null, mode: r.mode, at: Date.now() }
      setHistory((h) => {
        const next = [item, ...h].slice(0, 12)
        try {
          sessionStorage.setItem('cc-sent', JSON.stringify(next))
        } catch {
          /* private mode */
        }
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const shown: Trail | null = result ?? viewed

  return (
    <div className="live">
      <header className="phead">
        <div>
          <h1>Send a complaint through the funnel</h1>
          <p>It runs on the real engine. Watch which check settles it, how sure it was, how long it took and what it cost. Then watch the Top 10 move.</p>
        </div>
      </header>

      <div className="live__grid">
        <form className="panel live__form" onSubmit={send}>
          <div className="panel__body live__form-body">
            <div className="field">
              <span id="ch-label">Channel</span>
              <div className="seg live__channels" role="group" aria-labelledby="ch-label">
                {CHANNELS.map((c) => (
                  <button key={c} type="button" aria-pressed={channel === c} onClick={() => setChannel(c)}>
                    <ChannelIcon channel={c} size={15} />
                    {CHANNEL[c].label}
                  </button>
                ))}
              </div>
            </div>

            <label className="field">
              <span>Complaint</span>
              <textarea
                name="complaint"
                className="textarea live__text"
                rows={5}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="paise kat gaye lekin order nahi bana…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
                }}
                required
              />
            </label>

            <div className="live__samples" aria-label="Sample complaints">
              {SAMPLES.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setText(s.text)
                    setChannel(s.channel)
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="live__ids">
              <label className="field">
                <span>{field.label} (optional)</span>
                <input className="input" name={field.key} type={field.type} inputMode={field.type === 'tel' ? 'tel' : field.type === 'email' ? 'email' : 'text'} value={ident} onChange={(e) => setIdent(e.target.value)} placeholder={field.placeholder} autoComplete="off" spellCheck={false} />
              </label>
              <label className="field">
                <span>Order ID (optional)</span>
                <input className="input mono" name="order_id" value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="BN-123456-7…" autoComplete="off" spellCheck={false} />
              </label>
            </div>

            {error && (
              <p className="live__error" role="alert">
                {error}
              </p>
            )}

            <div className="live__send">
              <button className="btn btn--primary btn--lg" type="submit" disabled={busy}>
                {busy ? <Loader2 size={17} className="spin" /> : <Send size={17} />}
                {busy ? 'Going through the funnel…' : 'Send through the funnel'}
              </button>
              <span className="live__hint">
                {conn.mode === 'snapshot' ? 'API offline: start the backend to send.' : 'Ctrl + Enter sends'}
              </span>
            </div>
          </div>

          <div className="live__phone">
            <QRSvg url={phoneUrl()} size={104} />
            <div>
              <strong>
                <Smartphone size={15} aria-hidden="true" /> Or be the customer
              </strong>
              <p>Scan with a phone on the same Wi-Fi, send a complaint, and it lands on every screen here.</p>
            </div>
          </div>
        </form>

        <section className="panel live__out" aria-live="polite" aria-label="Path through the funnel">
          <div className="panel__body">
            <AnimatePresence mode="wait">
              {busy ? (
                <motion.div key="busy" className="live__busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="live__pulse" aria-hidden="true">
                    {['Gate', 'Similarity', 'Verify', 'LLM'].map((s, i) => (
                      <span key={s} style={{ animationDelay: `${i * 0.25}s` }}>
                        {s}
                      </span>
                    ))}
                  </div>
                  <p>The engine is reading it…</p>
                </motion.div>
              ) : shown ? (
                <motion.div key={shown.complaint.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <TrailView trail={shown} mode={result?.mode} warning={result?.warning} />
                  {filedNow && result && (
                    <p className="live__now">
                      That issue is now <strong>#{filedNow.rank}</strong> with <strong>{filedNow.unique_customers} customers</strong> and {filedNow.complaints} complaints.
                    </p>
                  )}
                </motion.div>
              ) : (
                <motion.div key="idle" className="live__idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <p className="live__idle-lead">Send one and watch it go through these checks, cheapest first. Each one settles what it can.</p>
                  <ol className="live__idle-steps">
                    {[
                      ['Who sent this', 'Sender email, caller number, chat login or a verified order ID'],
                      ['Gate', 'Jev: is it a complaint, which area, how bad, money or safety at risk'],
                      ['Similarity', 'Free and local: close to a known issue?'],
                      ['Verify', 'Jev: same problem as issue X? yes or no'],
                      ['LLM', 'Claude Haiku, only for what is still unsure'],
                    ].map(([name, what], i) => (
                      <li key={name} style={{ animationDelay: `${i * 0.18}s` }}>
                        <span className="live__idle-n mono">{i + 1}</span>
                        <span>
                          <strong>{name}</strong>
                          {what}
                        </span>
                      </li>
                    ))}
                  </ol>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>
      </div>

      {history.length > 0 && (
        <section className="panel live__hist" aria-labelledby="hist-title">
          <div className="panel__head">
            <h2 id="hist-title" className="panel__title">
              Sent from this screen
            </h2>
            <button
              className="btn btn--sm btn--ghost"
              onClick={() => {
                setHistory([])
                try {
                  sessionStorage.removeItem('cc-sent')
                } catch {
                  /* private mode */
                }
              }}
            >
              <RotateCcw size={14} /> Clear list
            </button>
          </div>
          <ul className="panel__body live__hist-list">
            {history.map((h) => (
              <li key={h.id + h.at}>
                <button onClick={() => setParams({ trail: h.id })}>
                  <span className="mono live__hist-id">{h.id}</span>
                  <span className="live__hist-text">{h.text}</span>
                  <span className="live__hist-stage">
                    <span className="feed__pip" style={{ background: STAGE[h.settled as keyof typeof STAGE]?.color }} />
                    {h.title ?? STAGE[h.settled as keyof typeof STAGE]?.label}
                  </span>
                  <span className={`live__hist-mode is-${h.mode}`}>{h.mode === 'live' ? 'Live' : 'Offline'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
