import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './ThemeContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { ConfirmProvider } from './components/ConfirmDialog.jsx'
import AuthGate from './components/AuthGate.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <ConfirmProvider>
          <AuthGate>
            <App />
          </AuthGate>
        </ConfirmProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
