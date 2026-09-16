import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { toast } from 'sonner'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { AuthShell } from '@/components/layout/AuthShell'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

const schema = z.object({
  loginid: z.string().min(1, 'Login ID is required'),
  password: z.string().min(1, 'Password is required'),
})

export function Login() {
  const { setAuth, setPlatformAuth } = useAuthStore()
  const navigate = useNavigate()
  const [showPass, setShowPass] = useState(false)
  const [loginid, setLoginid] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ loginid?: string; password?: string }>({})
  const [isSubmitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const parsed = schema.safeParse({ loginid, password })
    if (!parsed.success) {
      const fieldErrors: typeof errors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as 'loginid' | 'password'
        if (!fieldErrors[key]) fieldErrors[key] = issue.message
      }
      setErrors(fieldErrors)
      return
    }
    setErrors({})
    setSubmitting(true)
    try {
      const res = await authApi.login(parsed.data)

      // One login page, two destinations. The account itself decides: a super
      // admin gets a control-plane token and the /super panel, everybody else
      // lands in their own customer's CRM.
      if (res.scope === 'platform') {
        setPlatformAuth(res.token, res.user)
        navigate({ to: '/super' })
        return
      }

      setAuth(res.token, res.user, {
        tenant: res.tenant ?? null,
        features: res.features ?? {},
        labels: res.labels ?? {},
        // The login response carries this too. Without it the store stays blank
        // until /auth/me lands, and a blank config means EVERY lead field
        // renders — so a B2B customer saw NEET, UCAT and DMAT on first paint,
        // and kept seeing them for as long as /auth/me was slow or failing.
        leadFields: res.leadFields ?? undefined,
      })
      navigate({ to: '/' })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell title="Sign in" subtitle="Use your login ID to continue.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Login ID</label>
          <input
            value={loginid}
            onChange={(e) => setLoginid(e.target.value)}
            className="w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary bg-background"
            placeholder="Enter your login ID"
            autoComplete="username"
          />
          {errors.loginid && (
            <p className="text-destructive text-xs mt-1">{errors.loginid}</p>
          )}
        </div>

        <div>
          <label className="text-sm font-medium mb-1.5 block">Password</label>
          <div className="relative">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPass ? 'text' : 'password'}
              className="w-full px-3 py-2.5 pr-10 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary bg-background"
              placeholder="Enter your password"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPass((p) => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && (
            <p className="text-destructive text-xs mt-1">{errors.password}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign In
        </button>

        <div className="text-center">
          <Link
            to="/forgot-password"
            className="text-sm text-primary hover:underline"
          >
            Forgot password?
          </Link>
        </div>
      </form>
    </AuthShell>
  )
}
