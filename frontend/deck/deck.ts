// The pitch deck as a web page: 1920x1080 slides scaled to the window, steps inside slides,
// keyboard / click / swipe navigation, speaker notes (N), fullscreen (F), a link per slide.
// Why a page and not a .pptx: the deck lives next to the product, uses its look, and its
// diagrams move. Every number on it is a measured one from the live run (see HANDOFF.md).
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import QRCode from 'qrcode'

const slides = Array.from(document.querySelectorAll<HTMLElement>('.slide'))
const stage = document.querySelector<HTMLElement>('.stage')!
const bar = document.querySelector<HTMLElement>('.progress span')!
const counter = document.querySelector<HTMLElement>('.counter')!
const notes = document.querySelector<HTMLElement>('.notes-panel')!
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

let index = 0
let step = 0
const steps = (s: HTMLElement) => Math.max(0, ...Array.from(s.querySelectorAll<HTMLElement>('[data-step]')).map((e) => Number(e.dataset.step)))

function fit() {
  // the layout viewport, so a phone's pinch zoom never changes the slide's scale
  const w = document.documentElement.clientWidth || window.innerWidth
  const h = document.documentElement.clientHeight || window.innerHeight
  const k = Math.min(w / 1920, h / 1080)
  stage.style.transform = `translate(-50%, -50%) scale(${k})`
}

function render(direction = 1) {
  slides.forEach((s, i) => {
    s.classList.toggle('is-active', i === index)
    s.classList.toggle('is-past', i < index)
    s.setAttribute('aria-hidden', String(i !== index))
  })
  const s = slides[index]
  s.querySelectorAll<HTMLElement>('[data-step]').forEach((e) => e.classList.toggle('is-shown', Number(e.dataset.step) <= step))
  s.dataset.step = String(step)
  bar.style.width = `${((index + 1) / slides.length) * 100}%`
  counter.textContent = `${index + 1} / ${slides.length}`
  notes.innerHTML = s.querySelector('aside')?.innerHTML ?? ''
  if (location.hash !== `#${s.id}`) history.replaceState(null, '', `#${s.id}`)
  if (step === 0 || direction < 0) countUp(s)
}

function go(i: number, atEnd = false) {
  const next = Math.max(0, Math.min(slides.length - 1, i))
  const dir = next >= index ? 1 : -1
  index = next
  step = atEnd ? steps(slides[index]) : 0
  render(dir)
}
function next() {
  if (step < steps(slides[index])) {
    step++
    render()
    countUp(slides[index])
  } else if (index < slides.length - 1) go(index + 1)
}
function prev() {
  if (step > 0) {
    step--
    render(-1)
  } else if (index > 0) go(index - 1, true)
}

// Numbers count up when they come on screen: [data-count="96"] with optional data-suffix/prefix/decimals.
function countUp(s: HTMLElement) {
  s.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
    const holder = el.closest<HTMLElement>('[data-step]')
    if (holder && !holder.classList.contains('is-shown')) return
    if (el.dataset.done === String(index)) return
    el.dataset.done = String(index)
    const to = Number(el.dataset.count)
    const dec = Number(el.dataset.decimals ?? 0)
    const fmt = (v: number) => `${el.dataset.prefix ?? ''}${v.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${el.dataset.suffix ?? ''}`
    if (reduce) {
      el.textContent = fmt(to)
      return
    }
    const t0 = performance.now()
    const dur = 1400
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur)
      el.textContent = fmt(to * (1 - Math.pow(1 - p, 4)))
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  // leaving a slide resets its counters, so they run again next time
  slides.forEach((o, i) => i !== index && o.querySelectorAll<HTMLElement>('[data-count]').forEach((e) => delete e.dataset.done))
}

// QR codes: [data-qr] points at the site's pages. Opened as a file (the offline copy), there is
// no site to point at, so it points at the live deployment instead.
const LIVE = 'https://hackstellar-three.vercel.app'
document.querySelectorAll<HTMLElement>('[data-qr]').forEach((el) => {
  try {
    const base = location.protocol.startsWith('http') ? location.origin : LIVE
    const url = new URL(el.dataset.qr!, base).href
    QRCode.toString(url, { type: 'svg', margin: 0, color: { dark: '#0a0a0b', light: '#f2efe8' } }).then((svg) => (el.innerHTML = svg))
    const label = el.parentElement?.querySelector('[data-qr-url]')
    if (label) label.textContent = url.replace(/^https?:\/\//, '')
  } catch {
    // a missing QR code must never stop the deck
  }
})

// One square per complaint: data-waffle="g44 d5 x1" is 44 of kind g, then 5 of d, then 1 of x.
document.querySelectorAll<HTMLElement>('[data-waffle]').forEach((el) => {
  let i = 0
  el.innerHTML = el.dataset.waffle!.split(' ').map((part) => {
    const kind = part[0]
    return Array.from({ length: Number(part.slice(1)) }, () => `<i class="c-${kind}" style="--i:${i++}"></i>`).join('')
  }).join('')
})

// Funnel particles: dots ride the funnel's paths, weighted by how many complaints took each.
function particles() {
  const cv = document.querySelector<HTMLCanvasElement>('#funnel-canvas')
  const svg = document.querySelector<SVGSVGElement>('#funnel-svg')
  if (!cv || !svg || reduce) return
  const ctx = cv.getContext('2d')!
  const paths = Array.from(svg.querySelectorAll<SVGPathElement>('path[data-w]'))
  const weights = paths.map((p) => Number(p.dataset.w))
  const sum = weights.reduce((a, b) => a + b, 0)
  type P = { path: SVGPathElement; len: number; t: number; v: number; off: number; color: string }
  let ps: P[] = []
  const pick = () => {
    let r = Math.random() * sum
    for (let i = 0; i < paths.length; i++) if ((r -= weights[i]) <= 0) return paths[i]
    return paths[0]
  }
  let last = performance.now()
  const frame = (now: number) => {
    requestAnimationFrame(frame)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (!slides[index].contains(cv)) return
    if (ps.length < 260) for (let i = 0; i < 3; i++) {
      const path = pick()
      ps.push({ path, len: path.getTotalLength(), t: 0, v: 260 + Math.random() * 120, off: (Math.random() - 0.5) * Number(path.dataset.spread ?? 30), color: path.dataset.color ?? '#f3ddb0' })
    }
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.globalCompositeOperation = 'lighter'
    ps = ps.filter((p) => {
      p.t += p.v * dt
      if (p.t >= p.len) return false
      const pt = p.path.getPointAtLength(p.t)
      ctx.fillStyle = p.color
      ctx.globalAlpha = Math.min(1, (p.len - p.t) / 80)
      ctx.beginPath()
      ctx.arc(pt.x, pt.y + p.off, 2.6, 0, Math.PI * 2)
      ctx.fill()
      return true
    })
  }
  requestAnimationFrame(frame)
}

// input
window.addEventListener('keydown', (e) => {
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) {
    e.preventDefault()
    next()
  } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) {
    e.preventDefault()
    prev()
  } else if (e.key === 'Home') go(0)
  else if (e.key === 'End') go(slides.length - 1)
  else if (e.key.toLowerCase() === 'f') {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen()
  } else if (e.key.toLowerCase() === 'n') document.body.classList.toggle('show-notes')
})
document.querySelector('.nav-next')?.addEventListener('click', next)
document.querySelector('.nav-prev')?.addEventListener('click', prev)
stage.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('a, button')) return
  const x = e.clientX / window.innerWidth
  if (x < 0.25) prev()
  else next()
})
let tx = 0
window.addEventListener('touchstart', (e) => (tx = e.touches[0].clientX), { passive: true })
window.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].clientX - tx
  if (Math.abs(dx) > 50) (dx < 0 ? next : prev)()
})
window.addEventListener('resize', fit)
// a link to another slide (#ranking) works without a reload
window.addEventListener('hashchange', () => {
  const i = slides.findIndex((sl) => `#${sl.id}` === location.hash)
  if (i >= 0 && i !== index) go(i)
})

// Printing (or "Save as PDF") lays every slide out fully built, one per page.
window.addEventListener('beforeprint', () => {
  slides.forEach((s) => s.classList.add('is-active'))
  document.querySelectorAll<HTMLElement>('[data-step]').forEach((e) => e.classList.add('is-shown'))
})
window.addEventListener('afterprint', () => go(index))

const start = slides.findIndex((s) => `#${s.id}` === location.hash)
fit()
particles()
go(start >= 0 ? start : 0)
document.body.classList.add('ready')
