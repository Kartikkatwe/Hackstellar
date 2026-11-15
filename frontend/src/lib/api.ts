import { useEffect, useSyncExternalStore } from 'react'
import type { LiveResult, Mode, NewComplaint, Trail } from './types'

/* Data layer: one shared cache, polled while a screen needs it.
   Why polling: the backend says "poll /funnel once a second is enough for a demo", and it is
        what makes a complaint typed on a judge's phone appear on the big screen.
   Why a snapshot fallback: if the API dies on stage, the console still opens on the real
        live-run numbers, and every screen says "Snapshot" so nobody mistakes it for live.
   Not: a data library. Thirty lines of cache beat a dependency here. */

const BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api'

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let snapshotRoutes: Record<string, unknown> | null = null
let snapshotMeta: { captured_at: string; source: string } | null = null
async function loadSnapshot() {
  if (!snapshotRoutes) {
    const mod = (await import('../snapshot/data.json')).default as {
      captured_at: string
      source: string
      routes: Record<string, unknown>
    }
    snapshotRoutes = mod.routes
    snapshotMeta = { captured_at: mod.captured_at, source: mod.source }
  }
  return snapshotRoutes
}

async function fetchJson(path: string, init?: RequestInit, timeoutMs = 6000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(BASE + path, { ...init, signal: ctrl.signal, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
    if (!res.ok) {
      let msg = res.statusText
      try {
        const body = await res.json()
        msg = body.detail ?? msg
      } catch {
        /* not json */
      }
      throw new HttpError(res.status, String(msg))
    }
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

/** Offline means the API cannot answer at all (network, proxy 5xx, or no run in the database). */
function isOffline(e: unknown) {
  if (e instanceof HttpError) return e.status >= 500 || e.status === 409
  return true
}

/* ---------------- connection state ---------------- */
type Conn = { mode: Mode | 'connecting'; lastOk: number; snapshotAt: string | null }
let conn: Conn = { mode: 'connecting', lastOk: 0, snapshotAt: null }
const connListeners = new Set<() => void>()
function setConn(next: Partial<Conn>) {
  const merged = { ...conn, ...next }
  if (merged.mode !== conn.mode || merged.lastOk !== conn.lastOk || merged.snapshotAt !== conn.snapshotAt) {
    conn = merged
    connListeners.forEach((l) => l())
  }
}
export function useConnection() {
  return useSyncExternalStore(
    (cb) => {
      connListeners.add(cb)
      return () => connListeners.delete(cb)
    },
    () => conn,
  )
}

export async function apiGet<T>(path: string): Promise<{ data: T; mode: Mode }> {
  try {
    const data = (await fetchJson(path)) as T
    setConn({ mode: 'live', lastOk: Date.now() })
    return { data, mode: 'live' }
  } catch (e) {
    if (!isOffline(e)) throw e
    const snap = await loadSnapshot()
    const hit = snap[path]
    setConn({ mode: 'snapshot', snapshotAt: snapshotMeta?.captured_at ?? null })
    if (hit === undefined) throw new Error('The API is offline and this view was not in the snapshot.')
    return { data: hit as T, mode: 'snapshot' }
  }
}

export async function postComplaint(body: NewComplaint): Promise<LiveResult> {
  try {
    const data = (await fetchJson('/complaints', { method: 'POST', body: JSON.stringify(body) }, 120000)) as LiveResult
    setConn({ mode: 'live', lastOk: Date.now() })
    refreshAll()
    return data
  } catch (e) {
    if (isOffline(e)) {
      setConn({ mode: 'snapshot' })
      throw new Error('The API is not reachable, so this complaint could not go through the funnel. Start the backend (uvicorn app.api:app --port 8000) and send it again.')
    }
    throw e
  }
}

export async function getTrail(id: string) {
  return apiGet<Trail>(`/complaints/${id}`)
}

/* ---------------- shared cache ---------------- */
type Entry = { data?: unknown; error?: string; mode?: Mode; at?: number; inflight?: boolean; version: number }
const cache = new Map<string, Entry>()
const listeners = new Map<string, Set<() => void>>()
const EMPTY: Entry = { version: 0 }

function notify(path: string) {
  listeners.get(path)?.forEach((l) => l())
}

export async function load(path: string) {
  const prev = cache.get(path) ?? { version: 0 }
  if (prev.inflight) return
  cache.set(path, { ...prev, inflight: true })
  try {
    const { data, mode } = await apiGet<unknown>(path)
    const same = prev.data !== undefined && JSON.stringify(prev.data) === JSON.stringify(data)
    cache.set(path, { data: same ? prev.data : data, mode, at: Date.now(), version: same ? prev.version : prev.version + 1 })
  } catch (e) {
    cache.set(path, { ...prev, inflight: false, error: e instanceof Error ? e.message : String(e) })
  }
  notify(path)
}

export function refreshAll() {
  for (const path of listeners.keys()) if ((listeners.get(path)?.size ?? 0) > 0) void load(path)
}

/** Subscribe to one endpoint; poll it every `interval` ms while mounted and the tab is visible. */
export function useApi<T>(path: string | null, interval = 0) {
  const entry = useSyncExternalStore(
    (cb) => {
      if (!path) return () => {}
      let set = listeners.get(path)
      if (!set) listeners.set(path, (set = new Set()))
      set.add(cb)
      return () => set!.delete(cb)
    },
    () => (path ? (cache.get(path) ?? EMPTY) : EMPTY),
  )
  useEffect(() => {
    if (!path) return
    const e = cache.get(path)
    if (!e || !e.at || Date.now() - e.at > 1500) void load(path)
    if (!interval) return
    const t = window.setInterval(() => {
      if (!document.hidden) void load(path)
    }, interval)
    return () => window.clearInterval(t)
  }, [path, interval])
  return {
    data: entry.data as T | undefined,
    error: entry.error,
    mode: entry.mode,
    version: entry.version,
    loading: entry.data === undefined && !entry.error,
  }
}

/* While on the snapshot, keep knocking: the moment the API answers, everything goes live again. */
if (typeof window !== 'undefined') {
  window.setInterval(() => {
    if (conn.mode === 'snapshot') {
      fetchJson('/health', undefined, 2500)
        .then(() => {
          setConn({ mode: 'live', lastOk: Date.now() })
          refreshAll()
        })
        .catch(() => {})
    }
  }, 4000)
}
