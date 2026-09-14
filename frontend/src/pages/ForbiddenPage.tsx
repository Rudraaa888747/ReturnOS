import { Link } from 'react-router-dom'
import { ErrorState } from '../components/ui'

export default function ForbiddenPage() {
  return (
    <main style={{ padding: 'var(--sp-10) var(--sp-4)', maxWidth: 640, margin: '0 auto' }}>
      <ErrorState
        kind="forbidden"
        title="You don't have access here"
        body="Your account role doesn't include this area. If you need it for your work, ask an administrator."
      />
      <p style={{ marginTop: 'var(--sp-4)' }}>
        <Link to="/">Back to home</Link>
      </p>
    </main>
  )
}
