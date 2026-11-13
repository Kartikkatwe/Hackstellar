// Records every read endpoint of a running backend into src/snapshot/data.json.
//
//   node scripts/snapshot.mjs [http://127.0.0.1:8000]
//
// Why: the console must still open if the API is down on stage. The snapshot is the
//      finished live run (1,500 complaints), and the UI labels it "Snapshot" whenever it is used.
// Not: a fake data generator. Every value here came from the real backend.
import { writeFile, mkdir } from 'node:fs/promises'

const base = process.argv[2] || 'http://127.0.0.1:8000'
const routes = {}

async function get(path) {
  const res = await fetch(base + path)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  const data = await res.json()
  routes[path] = data
  return data
}

const config = await get('/config')
for (const p of ['/health', '/funnel', '/cost', '/accuracy', '/pending', '/issues/top', '/issues/top?n=50', '/complaints?limit=40']) await get(p)

// One-filter views of the Top 10, for the segment chips.
for (const seg of config.segments) {
  for (const v of seg.values) await get(`/issues/top?${seg.key}=${encodeURIComponent(String(v))}`)
  await get(`/segments/heatmap?dim=${seg.key}`)
  const vals = seg.values.map(String)
  for (let i = 0; i < vals.length; i++)
    for (let j = 0; j < vals.length; j++)
      if (i !== j) await get(`/segments/compare?dim=${seg.key}&a=${encodeURIComponent(vals[i])}&b=${encodeURIComponent(vals[j])}`)
}

// Every issue's detail page.
const all = routes['/issues/top?n=50'].issues
for (const issue of all) await get(`/issues/${issue.issue_id}`)

// A few real complaint trails per stage, for the replay when the API is offline.
for (const stage of ['dropped', 'match', 'verify', 'llm', 'new_issue', 'pending']) {
  const list = await get(`/complaints?settled=${stage}&limit=4`)
  for (const c of list) await get(`/complaints/${c.id}`)
}

await mkdir(new URL('../src/snapshot/', import.meta.url), { recursive: true })
const out = { captured_at: new Date().toISOString(), source: 'grocery_live_backup.db', routes }
await writeFile(new URL('../src/snapshot/data.json', import.meta.url), JSON.stringify(out))
console.log(`${Object.keys(routes).length} routes, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`)
