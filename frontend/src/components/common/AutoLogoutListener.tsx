import { useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth.store'

// 1 Hour of Inactivity Timeout (60 minutes * 60 seconds * 1000 ms)
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000
// Throttle updating activity timestamp to once every 5 seconds
const ACTIVITY_THROTTLE_MS = 5_000
// Periodic check interval (every 10 seconds)
const CHECK_INTERVAL_MS = 10_000

const INTERACTION_EVENTS = ['click', 'keydown', 'scroll', 'touchstart', 'mousemove']

export function AutoLogoutListener() {
  const { isAuthenticated, touchActivity, logout } = useAuthStore()
  const navigate = useNavigate()
  const lastTouchRef = useRef<number>(Date.now())

  // 1. Listen for user interactions and touch activity timestamp (throttled)
  useEffect(() => {
    if (!isAuthenticated) return

    const handleUserActivity = () => {
      const now = Date.now()
      if (now - lastTouchRef.current >= ACTIVITY_THROTTLE_MS) {
        lastTouchRef.current = now
        touchActivity()
      }
    }

    INTERACTION_EVENTS.forEach((evt) => {
      window.addEventListener(evt, handleUserActivity, { passive: true })
    })

    return () => {
      INTERACTION_EVENTS.forEach((evt) => {
        window.removeEventListener(evt, handleUserActivity)
      })
    }
  }, [isAuthenticated, touchActivity])

  // 2. Periodically verify if inactivity limit (1 hour) has elapsed
  useEffect(() => {
    if (!isAuthenticated) return

    const performInactivityCheck = () => {
      const { lastActivityTime, touchActivity: initTouch } = useAuthStore.getState()
      
      // If user was already logged in before this feature shipped, initialize lastActivityTime to now
      if (!lastActivityTime) {
        initTouch()
        return
      }

      const elapsed = Date.now() - lastActivityTime
      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        logout()
        toast.error('Session expired due to 1 hour of inactivity. Please sign in again.')
        navigate({ to: '/login' })
      }
    }

    // Immediate check on mount or tab focus
    performInactivityCheck()

    const intervalId = setInterval(performInactivityCheck, CHECK_INTERVAL_MS)

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        performInactivityCheck()
      }
    }

    // Cross-tab activity synchronization via window storage event
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'crm-auth' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue)
          if (parsed?.state?.lastActivityTime) {
            useAuthStore.setState({ lastActivityTime: parsed.state.lastActivityTime })
          }
        } catch {
          // ignore parsing error
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('storage', handleStorageChange)

    return () => {
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [isAuthenticated, logout, navigate])

  return null
}
