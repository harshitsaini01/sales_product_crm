import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { leavesApi } from '@/lib/api'
import { toast } from 'sonner'

export function useLeaves() {
  return useQuery({ queryKey: ['leaves'], queryFn: leavesApi.list })
}

export function useCreateLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: leavesApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leaves'] })
      toast.success('Leave request submitted')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed'),
  })
}

export function useReviewLeave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, approvalNote }: { id: number; status: 'approved' | 'rejected'; approvalNote?: string }) =>
      leavesApi.review(id, { status, approvalNote }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leaves'] })
      toast.success('Leave reviewed')
    },
  })
}
