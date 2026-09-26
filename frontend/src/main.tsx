import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { SessionProvider } from './lib/session'
import { CartProvider } from './lib/cart'
import { DemoModeDialog } from './components/DemoModeDialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { router } from './app/router'
import './styles/tokens.css'
import './styles/base.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <SessionProvider>
        <CartProvider>
          <RouterProvider router={router} />
          <DemoModeDialog />
        </CartProvider>
      </SessionProvider>
    </ErrorBoundary>
  </StrictMode>,
)
