import { BrowserRouter, Link, Route, Routes, useOutlet } from 'react-router-dom'
import { MotionConfig } from 'motion/react'
import { FilterProvider } from './lib/filters'
import { Shell } from './components/Shell'
import Overview from './pages/Overview'
import Issues from './pages/Issues'
import IssueDetail from './pages/IssueDetail'
import Live from './pages/Live'
import FunnelCost from './pages/FunnelCost'
import Segments from './pages/Segments'
import Waiting from './pages/Waiting'
import AccuracyPage from './pages/AccuracyPage'
import Landing from './pages/Landing'
import PhoneSubmit from './pages/PhoneSubmit'
import { Logo } from './components/Logo'

/* Why useOutlet: the exiting page keeps rendering its own route while the next one fades in. */
function ConsoleLayout() {
  const outlet = useOutlet()
  return <Shell>{outlet}</Shell>
}

function NotFound() {
  return (
    <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}>
      <div style={{ display: 'grid', gap: 20, justifyItems: 'center' }}>
        <Logo size={44} wordmark={false} animate />
        <h1 style={{ fontSize: 32 }}>This page is off the map.</h1>
        <Link to="/console" className="btn btn--primary">
          Back to the console
        </Link>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <FilterProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/submit" element={<PhoneSubmit />} />
            <Route path="/console" element={<ConsoleLayout />}>
              <Route index element={<Overview />} />
              <Route path="issues" element={<Issues />} />
              <Route path="issues/:id" element={<IssueDetail />} />
              <Route path="live" element={<Live />} />
              <Route path="funnel" element={<FunnelCost />} />
              <Route path="segments" element={<Segments />} />
              <Route path="waiting" element={<Waiting />} />
              <Route path="accuracy" element={<AccuracyPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </FilterProvider>
    </MotionConfig>
  )
}
