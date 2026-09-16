// Force Asia/Kolkata for every date/time render in the app. MUST be imported
// before anything else — patches Date.prototype and Intl.DateTimeFormat so a
// VPN / misconfigured PC clock can't drift the displayed time from IST.
import './lib/force-ist'

import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { Toaster } from 'sonner'
import { queryClient } from './lib/queryClient'
import { router } from './router'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster richColors position="top-right" toastOptions={{ className: 'font-sans' }} />
    </QueryClientProvider>
  </React.StrictMode>
)
