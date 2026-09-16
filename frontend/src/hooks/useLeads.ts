import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { leadsApi } from '@/lib/api'
import { toast } from 'sonner'
import type { Lead, PaginatedResult } from '@/types'

export function useLeads(params?: Record<string, string>) {
  return useQuery<PaginatedResult<Lead>>({
    queryKey: ['leads', params],
    queryFn: () => leadsApi.list(params),
  })
}

export function useLead(id: number) {
  return useQuery<Lead>({
    queryKey: ['lead', id],
    queryFn: () => leadsApi.get(id),
    enabled: !!id,
  })
}

export function useCreateLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: leadsApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      toast.success('Lead created successfully')
    },
    onError: () => toast.error('Failed to create lead'),
  })
}

export function useUpdateLead(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => leadsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead', id] })
      qc.invalidateQueries({ queryKey: ['leads'] })
      toast.success('Lead updated')
    },
    onError: () => toast.error('Failed to update lead'),
  })
}

export function useDeleteLead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: leadsApi.delete,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      toast.success('Lead moved to trash')
    },
  })
}

export function useBulkAssign() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: leadsApi.bulkAssign,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      toast.success(`${vars.leadIds.length} leads assigned`)
    },
  })
}
