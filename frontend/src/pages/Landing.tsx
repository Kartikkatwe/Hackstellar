import { useEffect } from 'react'

// The product page is a separate static page (landing/index.html). The dev and preview servers
// serve it at "/"; if this React route is ever reached, hand over to it with a full page load.
// Why /landing/ and not "/": on a host without the rewrite, "/" is this app and would loop.
export default function Landing() {
  useEffect(() => {
    window.location.replace('/landing/')
  }, [])
  return null
}
