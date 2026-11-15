import { useSyncExternalStore } from 'react'

/* One switch for every loop that runs past 5 s (the funnel's particles, the compass sweep,
   the live rings): WCAG 2.2.2 and the web interface guidelines want a pause for them.
   Why on <html>: CSS loops pause with one attribute; the canvas reads the same store. */

let paused = (() => {
  try {
    return localStorage.getItem('cc-motion') === 'paused'
  } catch {
    return false
  }
})()
const listeners = new Set<() => void>()

function apply() {
  document.documentElement.toggleAttribute('data-motion-paused', paused)
}
if (typeof document !== 'undefined') apply()

export function setMotionPaused(next: boolean) {
  paused = next
  try {
    localStorage.setItem('cc-motion', next ? 'paused' : 'running')
  } catch {
    /* private mode */
  }
  apply()
  listeners.forEach((l) => l())
}

export function isMotionPaused() {
  return paused
}

export function useMotionPaused() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => paused,
  )
}
