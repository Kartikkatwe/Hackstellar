// Builds the pitch deck as ONE self-contained HTML file: styles, script and fonts inlined.
// Why: it opens by double-click with no server and no internet (a browser blocks module
//      scripts and font files loaded from file://), so it can be emailed or put on a USB stick.
// Run from frontend/:  node scripts/deck-offline.mjs  ->  ../docs/deck/export/Complaint-Compass-Pitch.html
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, '../docs/deck/export/Complaint-Compass-Pitch.html')

const result = await build({
  entryPoints: [resolve(root, 'deck/deck.ts')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  outdir: 'bundle',
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl' },
  logLevel: 'warning',
})
const file = (ext) => result.outputFiles.find((f) => f.path.endsWith(ext))?.text ?? ''
const js = file('.js').replaceAll('</script', '<\\/script')
const fonts = file('.css')
const css = readFileSync(resolve(root, 'deck/deck.css'), 'utf8')
const icon = 'data:image/svg+xml;base64,' + readFileSync(resolve(root, 'public/favicon.svg')).toString('base64')

let html = readFileSync(resolve(root, 'deck/index.html'), 'utf8')
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`deck/index.html no longer contains: ${from}`)
  html = html.replace(from, () => to)
}
swap('<link rel="stylesheet" href="/deck/deck.css">', `<style>\n${fonts}\n${css}\n</style>`)
swap('<script type="module" src="/deck/deck.ts"></script>\n', '')
swap('href="/favicon.svg"', `href="${icon}"`)
swap('</body>', `<script>\n${js}\n</script>\n</body>`)

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, html)
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`)
