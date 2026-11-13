import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import QRCode from 'qrcode'
import { X, Wifi } from 'lucide-react'
import './Modal.css'

/* The judge's phone becomes a customer: scan, type a complaint, and watch the console update.
   Why the LAN address: "localhost" on a phone is the phone. vite.config.ts bakes the laptop's IP in.
   Not: a public tunnel. The demo must not depend on venue internet. */

export function phoneUrl() {
  const { protocol, hostname, port } = window.location
  const local = hostname === 'localhost' || hostname === '127.0.0.1'
  const host = local && __LAN_HOST__ ? __LAN_HOST__ : hostname
  return `${protocol}//${host}${port ? `:${port}` : ''}/submit`
}

export function QRSvg({ url, size = 220 }: { url: string; size?: number }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0a0a0b', light: '#f2efe8' } })
      .then(setSvg)
      .catch(() => setSvg(''))
  }, [url])
  return <div className="qr" style={{ width: size, height: size }} role="img" aria-label={`QR code for ${url}`} dangerouslySetInnerHTML={{ __html: svg }} />
}

export function PhoneQR({ open, onClose }: { open: boolean; onClose: () => void }) {
  const url = useMemo(() => (open ? phoneUrl() : ''), [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  const local = typeof window !== 'undefined' && url.includes('localhost')
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            className="modal__card modal__card--qr"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qr-title"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button className="modal__x btn btn--ghost btn--sm" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
            <div className="qrcard">
              <div className="qrcard__code">
                <QRSvg url={url} size={232} />
                <span className="qrcard__scan" aria-hidden="true" />
              </div>
              <div className="qrcard__text">
                <h2 id="qr-title">Be the customer</h2>
                <p>Scan with a phone camera, write a complaint in any words (Hinglish works), and send it. It goes through the real funnel, and this console updates while you watch.</p>
                <code className="qrcard__url">{url}</code>
                <p className="qrcard__note">
                  <Wifi size={14} aria-hidden="true" />
                  {local ? 'Start the frontend with npm run dev; the phone needs the laptop’s Wi-Fi address.' : 'The phone must be on the same Wi-Fi as this laptop.'}
                </p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
