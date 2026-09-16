import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Smartphone, Loader2 } from 'lucide-react'
import { callsApi } from '@/lib/api'

/**
 * Sends an FCM push to the assigned counsellor's Android app, telling it to
 * auto-dial this lead. Falls back gracefully if the counsellor has no device.
 */
export function PushToPhoneButton({
  leadId,
  counsellorId,
  disabled,
}: {
  leadId: number
  counsellorId?: number
  disabled?: boolean
}) {
  const trigger = useMutation({
    mutationFn: () => callsApi.trigger({ leadId, counsellorId }),
    onSuccess: (data: { delivered: boolean }) => {
      if (data.delivered) toast.success('Phone is ringing — counsellor will dial')
      else toast.warning('Push sent but device did not acknowledge')
    },
    onError: (err: { response?: { status?: number; data?: { error?: string } } }) => {
      const status = err.response?.status
      const msg = err.response?.data?.error
      if (status === 409) toast.error('Counsellor has no registered phone')
      else if (status === 404) toast.error(msg ?? 'Lead has no phone number')
      else toast.error(msg ?? 'Failed to trigger call')
    },
  })

  return (
    <button
      onClick={() => trigger.mutate()}
      disabled={disabled || trigger.isPending}
      title="Push to counsellor's phone"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
    >
      {trigger.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Smartphone className="h-3.5 w-3.5" />}
      Push to phone
    </button>
  )
}
