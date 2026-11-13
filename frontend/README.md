# Complaint Compass: frontend

The console for the Complaint Compass engine in `../backend`. React 19, Vite 6 and TypeScript, with Motion for animation and D3 for chart geometry. Fonts are bundled locally (Geist and Geist Mono), so the app needs no internet at the venue.

## Run it

1. Start the backend from `backend/` (see `backend/README.md`):

   ```bash
   cp runs/grocery_live_backup.db runs/grocery.db
   uvicorn app.api:app --host 0.0.0.0 --port 8000
   ```

   With `OPENROUTER_API_KEY` in `backend/.env`, typed complaints use the real Jev and Claude Haiku. Without it they use offline stand-ins, and the UI says so.

2. Start the frontend from `frontend/`:

   ```bash
   npm install
   npm run dev
   ```

   Open http://localhost:5173. The product page is at `/`, the console at `/console` and the phone form at `/submit`.

3. For a production build, run `npm run build`, then `npm run preview` (port 4173). It serves the same three addresses, with the same `/api` proxy.

The sidebar has a "Pause animation" switch that stops every looping animation: the funnel particles, the compass sweep and the live rings.

## How it talks to the backend

- The dev server proxies `/api/*` to `http://127.0.0.1:8000`. Set `API_TARGET` to point it somewhere else. The browser calls `/api`; set `VITE_API_BASE` to call another URL directly.
- Every screen polls the endpoints it shows: the funnel every 2.5 s, the feed every 2 s, the Top 10 every 4 s. A complaint sent from any device appears on every open screen within about 2 seconds.
- If the API cannot be reached, the console falls back to `src/snapshot/data.json`, a recording of the finished live run, and labels every screen "Snapshot". It switches back to live when the API answers again. To refresh the snapshot from a running backend, run `node scripts/snapshot.mjs`.

## Judges on their phones

The "Complain from a phone" card in the sidebar shows a QR code for `http://<laptop LAN IP>:5173/submit`. The dev server listens on the LAN (`host: true`) and works out the laptop's IP when it starts. The phone must be on the same Wi-Fi. Its complaint goes through the same `POST /complaints` and lands in the console's live feed.

## Where things are

| Path | What |
|---|---|
| `src/lib/api.ts` | Shared cache, polling, connection state, snapshot fallback |
| `src/lib/meta.ts` | Fixed channel, stage and badge identities (colours validated for colour-blind safety) |
| `src/styles/tokens.css` | Design tokens: warm black, brass accent, chart palettes |
| `src/components/CompassDial.tsx` | The compass: business areas around the bezel, the Top 10 inside, the needle on the issue in focus |
| `src/components/FunnelFlow.tsx` | The funnel as a Sankey with particles, computed from `GET /funnel` |
| `src/components/Trail.tsx` | One complaint's path, replayed from what the backend recorded |
| `src/pages/` | Overview, Top issues, Issue detail, Live intake, Funnel and cost, Customer groups, Unconfirmed, Accuracy, Phone form |
| `landing/` | The product page: static HTML built on the taste-skill kit (`public/kit`), with live numbers from the API (`landing.ts`) |
| `public/console-poster*.jpg` | Stills of the console, shown in the product page's app window until the live console loads |
