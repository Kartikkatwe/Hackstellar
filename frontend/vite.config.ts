import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import os from 'node:os'

// Why: the phone page is opened from a QR code, so it needs the laptop's LAN address.
//      A browser cannot read its own LAN IP, so the dev server bakes it in at start.
// Not: a hard-coded IP. The hackathon Wi-Fi hands out a new one every time.
function lanAddress(): string | null {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  return null
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
    plugins: [react()],
    define: { __LAN_HOST__: JSON.stringify(lanAddress()) },
    server: { host: true, port: 5173, proxy },
    preview: { host: true, port: 4173, proxy },
  }
})
