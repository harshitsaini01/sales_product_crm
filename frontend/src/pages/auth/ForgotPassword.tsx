import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { authApi } from '@/lib/api'
import { AuthShell } from '@/components/layout/AuthShell'
import { Eye, EyeOff, Loader2, ArrowLeft } from 'lucide-react'

type Stage = 'email' | 'otp' | 'reset'

export function ForgotPassword() {
  const navigate = useNavigate()
  const [stage, setStage] = useState<Stage>('email')
  const [submitting, setSubmitting] = useState(false)

  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  async function onSendOtp(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return toast.error('Enter your email')
    setSubmitting(true)
    try {
      await authApi.forgotPassword({ email: email.trim() })
      toast.success('OTP sent. Check your email.')
      setStage('otp')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Failed to send OTP')
    } finally {
      setSubmitting(false)
    }
  }

  async function onVerifyOtp(e: FormEvent) {
    e.preventDefault()
    if (otp.length !== 6) return toast.error('Enter the 6-digit OTP')
    setSubmitting(true)
    try {
      const res = await authApi.verifyOtp({ email: email.trim(), otp })
      setResetToken(res.resetToken)
      toast.success('OTP verified')
      setStage('reset')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Invalid OTP')
    } finally {
      setSubmitting(false)
    }
  }

  async function onResetPassword(e: FormEvent) {
    e.preventDefault()
    if (newPassword.length < 6) return toast.error('Password must be at least 6 characters')
    if (newPassword !== confirmPassword) return toast.error('Passwords do not match')
    setSubmitting(true)
    try {
      await authApi.resetPassword({ resetToken, newPassword })
      toast.success('Password updated. Please sign in.')
      navigate({ to: '/login' })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Failed to reset password')
    } finally {
      setSubmitting(false)
    }
  }

  async function onResendOtp() {
    setSubmitting(true)
    try {
      await authApi.forgotPassword({ email: email.trim() })
      toast.success('A new OTP has been sent.')
      setOtp('')
    } catch {
      toast.error('Failed to resend OTP')
    } finally {
      setSubmitting(false)
    }
  }

  const subtitle =
    stage === 'email'
      ? 'Enter your email to receive a verification code'
      : stage === 'otp'
        ? `Enter the 6-digit OTP sent to ${email}`
        : 'Choose your new password'

  const fieldClass =
    'w-full px-3 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary bg-background'
  const btnClass =
    'w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors'

  return (
    <AuthShell title="Reset password" subtitle={subtitle}>
          {stage === 'email' && (
            <form onSubmit={onSendOtp} className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={fieldClass}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className={btnClass}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Send OTP
              </button>
            </form>
          )}

          {stage === 'otp' && (
            <form onSubmit={onVerifyOtp} className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">OTP</label>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3 py-2.5 border rounded-lg text-lg tracking-[0.5em] text-center focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary bg-background"
                  placeholder="000000"
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className={btnClass}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Verify OTP
              </button>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => setStage('email')}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Change email
                </button>
                <button
                  type="button"
                  onClick={onResendOtp}
                  disabled={submitting}
                  className="text-primary hover:underline disabled:opacity-50"
                >
                  Resend OTP
                </button>
              </div>
            </form>
          )}

          {stage === 'reset' && (
            <form onSubmit={onResetPassword} className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">New Password</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className={`${fieldClass} pr-10`}
                    placeholder="Enter new password"
                    autoComplete="new-password"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Re-enter Password</label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`${fieldClass} pr-10`}
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className={btnClass}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Update Password
              </button>
            </form>
          )}

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to login
            </Link>
          </div>
    </AuthShell>
  )
}
