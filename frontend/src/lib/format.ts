const nf = new Intl.NumberFormat('en-IN')

/** The "out of" for scores: the top score rounded up to the next hundred (560.2 -> 600).
    Why: a score is a product with no natural maximum; this gives every issue a fixed yardstick. */
export const scoreScale = (max: number) => (max <= 0 ? 100 : Math.ceil(max / 100) * 100)

export const int = (n: number | undefined | null) => (n == null ? '–' : nf.format(Math.round(n)))
export const pct = (share: number | undefined | null, digits = 1) => (share == null ? '–' : `${(share * 100).toFixed(digits)}%`)
export const pctRaw = (p: number | undefined | null, digits = 1) => (p == null ? '–' : `${p.toFixed(digits)}%`)
export const fixed = (n: number | undefined | null, digits = 2) => (n == null ? '–' : n.toFixed(digits))

export function usd(n: number | undefined | null, digits?: number) {
  if (n == null) return '–'
  const d = digits ?? (n >= 100 ? 0 : n >= 1 ? 2 : n >= 0.01 ? 3 : 5)
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}

export function seconds(s: number | undefined | null) {
  if (s == null) return '–'
  if (s < 1) return `${Math.round(s * 1000)} ms`
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)} s`
  const m = Math.floor(s / 60)
  return `${m} min ${Math.round(s - m * 60)} s`
}

export function when(iso: string | undefined | null) {
  if (!iso) return '–'
  const d = new Date(iso)
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function ago(iso: string, now = Date.now()) {
  const diff = Math.max(0, now - new Date(iso).getTime()) / 1000
  if (diff < 45) return 'just now'
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`
  return `${Math.round(diff / 86400)} d ago`
}

export const day = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/** "order_accuracy" -> "Order accuracy", "account_app" -> "Account & app" */
export function componentName(key: string) {
  const special: Record<string, string> = { account_app: 'Account & app', order_accuracy: 'Order accuracy', product_quality: 'Product quality' }
  if (special[key]) return special[key]
  const s = key.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function segmentValue(v: string | boolean) {
  if (v === true || v === 'true') return 'Students'
  if (v === false || v === 'false') return 'Non-students'
  return String(v)
}
