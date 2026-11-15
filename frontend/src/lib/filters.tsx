import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/* The customer-group filter (country, state, age group, student status) is global:
   choose "Students" once and the Top 10, the compass and the overview all follow.
   Why sessionStorage: a judge who reloads keeps the view they were shown. */

type Filters = Record<string, string>
type Ctx = { filters: Filters; set: (key: string, value: string | null) => void; clear: () => void; query: string }

const FilterCtx = createContext<Ctx | null>(null)

function read(): Filters {
  try {
    return JSON.parse(sessionStorage.getItem('cc-filters') || '{}')
  } catch {
    return {}
  }
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<Filters>(read)
  const persist = (f: Filters) => {
    try {
      sessionStorage.setItem('cc-filters', JSON.stringify(f))
    } catch {
      /* private mode */
    }
  }
  const set = useCallback((key: string, value: string | null) => {
    setFilters((prev) => {
      const next = { ...prev }
      if (value == null) delete next[key]
      else next[key] = value
      persist(next)
      return next
    })
  }, [])
  const clear = useCallback(() => {
    setFilters({})
    persist({})
  }, [])
  const query = useMemo(
    () =>
      Object.entries(filters)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&'),
    [filters],
  )
  return <FilterCtx.Provider value={{ filters, set, clear, query }}>{children}</FilterCtx.Provider>
}

export function useFilters() {
  const ctx = useContext(FilterCtx)
  if (!ctx) throw new Error('useFilters outside FilterProvider')
  return ctx
}
