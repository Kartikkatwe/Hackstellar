import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Send, Loader2, ChevronDown, CheckCircle2 } from 'lucide-react'
import { postComplaint, useApi } from '../lib/api'
import type { Channel, Config, LiveResult } from '../lib/types'
import { CHANNEL } from '../lib/meta'
import { ChannelIcon } from '../components/ui'
import { LogoMark } from '../components/Logo'
import { TrailView } from '../components/Trail'
import './PhoneSubmit.css'

/* What a judge sees after scanning the QR code: the business's own help form.
   The complaint goes to the same POST /complaints as the console, so it lands on the big screen. */

const QUICK = ['paise kat gaye lekin order nahi bana, please check', 'I was charged twice for one order since I updated the app', 'Love the 10 minute delivery, great job team!']

export default function PhoneSubmit() {
  const { data: config } = useApi<Config>('/config')
  const [channel, setChannel] = useState<Channel>('chat')
  const [text, setText] = useState('')
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [res, setRes] = useState<LiveResult | null>(null)
  const [open, setOpen] = useState(false)
  const business = config?.business ?? 'BasketNow'

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const body = { channel, text: text.trim() } as Record<string, string>
      if (handle.trim()) body[channel === 'email' ? 'email' : channel === 'social' ? 'handle' : channel === 'call' ? 'phone' : 'user_id'] = handle.trim()
      setRes(await postComplaint(body as never))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const settled = res?.result.settled
  const headline =
    settled === 'dropped'
      ? 'Thanks for the kind words'
      : settled === 'pending'
        ? res?.result.urgent
          ? 'Flagged as urgent'
          : 'Logged, and we are watching for it'
        : settled === 'new_issue'
          ? 'You helped find a new problem'
          : 'Got it. We know this problem'

  return (
    <div className="phone">
      <header className="phone__top">
        <span className="phone__biz">{business} help</span>
        <span className="phone__by">
          <LogoMark size={18} /> Complaint Compass
        </span>
      </header>

      <AnimatePresence mode="wait">
        {!res ? (
          <motion.form key="form" className="phone__form" onSubmit={send} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <h1>What went wrong?</h1>
            <p className="phone__lede">Write it in your own words. English, Hindi or both.</p>

            <div className="phone__channels" role="group" aria-label="How are you reaching us">
              {(['chat', 'email', 'social', 'call'] as Channel[]).map((c) => (
                <button key={c} type="button" aria-pressed={channel === c} onClick={() => setChannel(c)}>
                  <ChannelIcon channel={c} size={16} />
                  {CHANNEL[c].label}
                </button>
              ))}
            </div>

            <label className="field">
              <span>Your complaint</span>
              <textarea name="complaint" className="textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Money was taken but my order never came…" required />
            </label>

            <div className="phone__quick">
              {QUICK.map((q) => (
                <button key={q} type="button" className="chip" onClick={() => setText(q)}>
                  {q.length > 34 ? q.slice(0, 34) + '…' : q}
                </button>
              ))}
            </div>

            <label className="field">
              <span>{channel === 'email' ? 'Your email' : channel === 'social' ? 'Your handle' : channel === 'call' ? 'Your number' : 'Your login'} (optional)</span>
              <input
                className="input"
                name="contact"
                type={channel === 'email' ? 'email' : channel === 'call' ? 'tel' : 'text'}
                inputMode={channel === 'email' ? 'email' : channel === 'call' ? 'tel' : 'text'}
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            {error && (
              <p className="phone__error" role="alert">
                {error}
              </p>
            )}

            <button className="btn btn--primary btn--lg phone__send" disabled={busy}>
              {busy ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
              {busy ? 'Sending…' : 'Send complaint'}
            </button>
          </motion.form>
        ) : (
          <motion.div key="done" className="phone__done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <motion.span className="phone__check" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
              <CheckCircle2 size={34} />
            </motion.span>
            <h1>{headline}</h1>
            {res.filed_under && (
              <p className="phone__filed">
                Filed under <strong>{res.filed_under.title}</strong>
              </p>
            )}
            <p className="phone__lede">Look at the big screen: your complaint just arrived there.</p>
            {res.mode === 'offline' && <p className="phone__offline">Processed with offline stand-in models, so the result is less reliable.</p>}

            <button className="phone__more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              How it was handled <ChevronDown size={16} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
            </button>
            {open && <TrailView trail={res} replay={false} />}

            <button
              className="btn btn--lg phone__again"
              onClick={() => {
                setRes(null)
                setText('')
                setOpen(false)
              }}
            >
              Send another
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
