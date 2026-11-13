// The product page's own script: local fonts, the console scaled into its window, live numbers.
// Why live numbers here too: a complaint sent from a phone moves this page as well, and every
// figure on it is the engine's, not copy. The measured values stay in the markup if the API is down.
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'

const API: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api'

async function json<T>(path: string): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5000)
  try {
    const r = await fetch(API + path, { signal: ctrl.signal })
    if (!r.ok) throw new Error(String(r.status))
    return (await r.json()) as T
  } finally {
    clearTimeout(t)
  }
}

function set(key: string, text: string) {
  document.querySelectorAll<HTMLElement>(`[data-live="${key}"]`).forEach((el) => {
    if (el.textContent !== text) el.textContent = text
  })
}

const pct = (n: number) => `${n.toFixed(1)}%`
const n = (v: number) => v.toLocaleString('en-IN')

type Funnel = { total: number; share_without_llm: number; stages: { stage: string; count: number }[] }
type Cost = { funnel: { per_100k_usd: number }; baseline: { models: { model: string; per_100k_usd: number }[] }; speedup: number }
type Acc = { issue: { accuracy_pct: number }; identity: { link_accuracy_pct: number }; component_accuracy_pct: number }
type Issue = { rank: number; title: string; unique_customers: number; badge: string }

async function refresh() {
  try {
    const [f, c, a, top] = await Promise.all([json<Funnel>('/funnel'), json<Cost>('/cost'), json<Acc>('/accuracy'), json<{ issues: Issue[] }>('/issues/top?n=50')])
    const get = (s: string) => f.stages.find((x) => x.stage === s)?.count ?? 0
    set('no-llm', pct(f.share_without_llm * 100))
    set('total', n(f.total))
    set('dropped', n(get('dropped')))
    set('match', n(get('match')))
    set('verify', n(get('verify')))
    set('llm', n(Math.round(f.total * (1 - f.share_without_llm))))
    set('per100k', `$${c.funnel.per_100k_usd.toFixed(2)}`)
    const haiku = c.baseline.models.find((m) => m.model.includes('haiku'))
    if (haiku) set('haiku100k', `$${haiku.per_100k_usd.toFixed(2)}`)
    set('speedup', `${c.speedup.toFixed(1)}×`)
    set('acc', pct(a.issue.accuracy_pct))
    set('links', `${Math.round(a.identity.link_accuracy_pct)}%`)
    set('component', pct(a.component_accuracy_pct))
    const by = (a as unknown as { issue: { by_stage: Record<string, { n: number; accuracy_pct: number }> } }).issue.by_stage
    for (const [k, key] of [['match', 'match'], ['verify', 'verify'], ['llm', 'llm'], ['new_issue', 'new']] as const) {
      if (!by?.[k]) continue
      set(`n-${key}`, n(by[k].n))
      set(`acc-${key}`, `${by[k].accuracy_pct.toFixed(1).replace(/\.0$/, '')}%`)
    }
    const dup = top.issues.find((i) => /duplicate payment/i.test(i.title))
    if (dup) set('dup-customers', n(dup.unique_customers))
    const list = document.querySelector('[data-live="top"]')
    if (list) {
      const items = top.issues.slice(0, 6)
      list.querySelectorAll('li').forEach((li, i) => {
        const it = items[i]
        if (!it) return
        const cells = li.children
        cells[0].textContent = String(it.rank)
        cells[1].textContent = it.title
        cells[2].textContent = it.badge
        cells[3].innerHTML = `<b class="n-harm">${it.unique_customers}</b> customers`
      })
    }
  } catch {
    /* API down: the measured values printed in the page stay */
  }
}

// The console is drawn at 1440 wide and scaled to the window, so it is the real thing, smaller.
function fitFrame() {
  document.querySelectorAll<HTMLElement>('.appframe__view').forEach((v) => {
    const virtual = Number(getComputedStyle(v).getPropertyValue('--vw')) || 1440
    v.style.setProperty('--s', String(v.clientWidth / virtual))
  })
}

fitFrame()
new ResizeObserver(fitFrame).observe(document.documentElement)
void refresh()
setInterval(() => {
  if (!document.hidden) void refresh()
}, 5000)
