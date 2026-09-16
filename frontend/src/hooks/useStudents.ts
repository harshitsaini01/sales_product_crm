import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi } from '@/lib/api'
import { toast } from 'sonner'

export function useStudents(params?: Record<string, string>) {
  return useQuery({ queryKey: ['students', params], queryFn: () => studentsApi.list(params) })
}

export function useStudent(id: number) {
  return useQuery({
    queryKey: ['students', id],
    queryFn: () => studentsApi.get(id),
    enabled: !!id,
  })
}

export function useEnrollStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ leadId, data }: { leadId: number; data?: Record<string, unknown> }) =>
      studentsApi.enroll(leadId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] })
      qc.invalidateQueries({ queryKey: ['leads'] })
      toast.success('Student enrolled')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed'),
  })
}

