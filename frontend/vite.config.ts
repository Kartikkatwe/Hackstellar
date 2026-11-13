import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import os from 'node:os'
import { resolve } from 'node:path'

// Why: the phone page is opened from a QR code, so it needs the laptop's LAN address.
//      A browser cannot read its own LAN IP, so the dev server bakes it in at start.
// Not: a hard-coded IP. The hackathon Wi-Fi hands out a new one every time.
function lanAddress(): string | null {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  return null
}

// Why: the product page is a static page built on the taste-skill kit (its own global CSS), so it
//      lives apart from the React console. "/" serves it; every other path is the console.
// Not: one React page for both. The kit's tokens (--ink, --muted) would fight the console's.
function landingAtRoot(): Plugin {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    const path = (req.url ?? '').split('?')[0]
    if (path === '/' || path === '/index.html') req.url = '/landing/' + (req.url ?? '').slice(path.length)
    next()
  }
  return {
    name: 'landing-at-root',
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Why a proxy: phones on the LAN only need to reach this server, never port 8000 directly.
  const proxy = {
    '/api': {
      target: env.API_TARGET || 'http://127.0.0.1:8000',
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/api/, ''),
    },
  }
  return {
    plugins: [react(), landingAtRoot()],
    define: { __LAN_HOST__: JSON.stringify(lanAddress()) },
    server: { host: true, port: 5173, proxy },
    preview: { host: true, port: 4173, proxy },
    build: {
      rollupOptions: {
        input: { main: resolve(__dirname, 'index.html'), landing: resolve(__dirname, 'landing/index.html') },
      },
    },
  }
})
