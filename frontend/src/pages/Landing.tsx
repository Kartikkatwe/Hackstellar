import { Navigate } from 'react-router-dom'

// Temporary: the product page is being built; until then the root opens the console.
export default function Landing() {
  return <Navigate to="/console" replace />
}
