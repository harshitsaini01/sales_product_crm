import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDate, maskPhone } from '@/lib/utils'
import { Search, ChevronLeft, ChevronRight, Loader2, GraduationCap } from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { FilterModeToggle } from '@/components/common/FilterModeToggle'
import type { PaginatedResult } from '@/types'

interface Student {
  id: number
  name: string
  email?: string
  mobile?: string
  city?: string
  country?: string
  course?: string
  totalFees?: number
  balanceFees?: number
  createdAt: string
  assignedTo?: Array<{ counsellor: { id: number; name: string } }>
}

export function Students() {
  const reveal = useAuthStore((s) => s.canRevealPhone())
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [excludeMode, setExcludeMode] = useState(false)

  const { data, isLoading } = useQuery<PaginatedResult<Student>>({
    queryKey: ['students', page, search, excludeMode],
    queryFn: () =>
      api.get('/students', {
        params: {
          page,
          limit: 25,
          ...(search ? { search } : {}),
          ...(search && excludeMode ? { excludeMode: '1' } : {}),
        },
      }).then((r) => r.data),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Students</h1>
        <span className="text-sm text-muted-foreground">{data?.total ?? 0} enrolled</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setSearch(searchInput); setPage(1) } }}
            placeholder="Search students..."
            className="w-full pl-9 pr-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          onClick={() => { setSearch(searchInput); setPage(1) }}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          Search
        </button>
        <FilterModeToggle excludeMode={excludeMode} onChange={setExcludeMode} label="" />
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 text-left font-medium text-muted-foreground">#</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Contact</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Location</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Course</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Fees</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Balance</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Counsellor</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Enrolled</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></td></tr>
              ) : !data?.data.length ? (
                <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No students found</td></tr>
              ) : (
                data.data.map((s, i) => (
                  <tr key={s.id} className="border-b hover:bg-muted/30 transition-colors">
                    <td className="p-3 text-muted-foreground">{(page - 1) * 25 + i + 1}</td>
                    <td className="p-3">
                      <span className="font-medium flex items-center gap-1.5">
                        <GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />
                        {s.name}
                      </span>
                    </td>
                    <td className="p-3 text-xs space-y-0.5">
                      {s.mobile && <div>{maskPhone(s.mobile, reveal)}</div>}
                      {s.email && <div className="text-muted-foreground">{s.email}</div>}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {[s.city, s.country].filter(Boolean).join(', ')}
                    </td>
                    <td className="p-3 text-xs">{s.course || '—'}</td>
                    <td className="p-3 text-xs">{s.totalFees ? `₹${s.totalFees.toLocaleString()}` : '—'}</td>
                    <td className="p-3 text-xs">
                      {s.balanceFees != null ? (
                        <span className={s.balanceFees > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>
                          ₹{s.balanceFees.toLocaleString()}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{s.assignedTo?.[0]?.counsellor?.name || '—'}</td>
                    <td className="p-3 text-xs text-muted-foreground">{formatDate(s.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t">
            <span className="text-sm text-muted-foreground">
              {(page - 1) * 25 + 1}–{Math.min(page * 25, data.total)} of {data.total}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded hover:bg-accent disabled:opacity-40">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-3 text-sm">{page} / {data.totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="p-1.5 rounded hover:bg-accent disabled:opacity-40">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
