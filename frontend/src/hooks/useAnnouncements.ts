import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { announcementsApi } from '@/lib/api'
import { toast } from 'sonner'

export function useAnnouncements() {
  return useQuery({ queryKey: ['announcements'], queryFn: announcementsApi.list })
}

export function useCreateAnnouncement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: announcementsApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['announcements'] })
      toast.success('Announcement published')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed'),
  })
}

export function useDeleteAnnouncement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: announcementsApi.delete,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['announcements'] })
      toast.success('Deleted')
    },
  })
}
