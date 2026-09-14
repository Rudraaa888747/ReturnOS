import { Link } from 'react-router-dom'
import { ErrorState } from '../components/ui'

export default function NotFoundPage() {
  return (
    <main style={{ padding: 'var(--sp-10) var(--sp-4)', maxWidth: 640, margin: '0 auto' }}>
      <ErrorState
        kind="not-found"
        title="This page doesn't exist"
        body="The link may be mistyped, or the item was removed. Check the address and try again."
      />
      <p style={{ marginTop: 'var(--sp-4)' }}>
        <Link to="/">Back to home</Link>
      </p>
    </main>
  )
}
