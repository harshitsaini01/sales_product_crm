import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { universityMailApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import {
  Mail, Search, Eye, CheckCircle2, Clock, Calendar,
  UserCheck, RotateCcw, FileText, ChevronLeft, ChevronRight,
  ExternalLink, X, Percent, Send, GraduationCap
} from 'lucide-react'

interface UniversityMailRecord {
  id: number
  studentId: number
  toEmail: string
  cc: string | null
  greeting: string | null
  recipientName: string | null
  senderName: string | null
  program?: string | null
  universityName?: string | null
  subject: string
  body: string
  attachedDocs: string[]
  sentByUserId: number | null
  trackingToken: string
  isOpened: boolean
  openCount: number
  firstOpenedAt: string | null
  lastOpenedAt: string | null
  createdAt: string
  updatedAt: string
  student?: {
    id: number
    name: string
    email: string
    mobile?: string
    country?: string
    intrestedCourse?: string
    intrestedUniversity?: string
  } | null
  sentBy?: {
    id: number
    name: string
    email: string
  } | null
}

interface UserOption {
  id: number
  name: string
  email: string
}

export function UniversityMailsPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin' || user?.role === 'sub-admin'

  // Filter States
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'opened' | 'unopened'>('all')
  const [sentByUserId, setSentByUserId] = useState('')
  const [universityName, setUniversityName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)
  const limit = 15

  // Modal State
  const [selectedMail, setSelectedMail] = useState<UniversityMailRecord | null>(null)

  const queryClient = useQueryClient()

  // Toggle Mail Opened Mutation
  const toggleOpenedMutation = useMutation({
    mutationFn: (id: number) => universityMailApi.toggleOpened(id),
    onSuccess: (res, id) => {
      toast.success(res.message || 'Mail status updated')
      queryClient.invalidateQueries({ queryKey: ['university-mails-all'] })
      if (selectedMail && selectedMail.id === id) {
        setSelectedMail((prev) =>
          prev
            ? {
                ...prev,
                isOpened: res.isOpened,
                openCount: res.openCount,
              }
            : null,
        )
      }
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Failed to update mail status')
    },
  })

  // Fetch University Mails
  const { data, isLoading } = useQuery({
    queryKey: ['university-mails-all', search, status, sentByUserId, universityName, startDate, endDate, page],
    queryFn: () =>
      universityMailApi.getAll({
        search,
        status,
        sentByUserId: sentByUserId || undefined,
        universityName: universityName || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        page,
        limit,
      }),
  })

  const apiMails: UniversityMailRecord[] = data?.items || []
  const rawSenders: UserOption[] = data?.senders || []

  // Strict role scoping fallback: non-admin users ONLY see mails for leads assigned to them
  const rawMails = useMemo(() => {
    if (isAdmin || !user?.id) return apiMails
    const currentUserId = Number(user.id)
    return apiMails.filter((m) => {
      const assignments = (m.student as any)?.assignedTo || []
      if (assignments.length > 0) {
        return assignments.some((a: any) => Number(a.clrId) === currentUserId)
      }
      return false
    })
  }, [apiMails, isAdmin, user?.id])

  // Dynamic senders filter based on selected target university
  const senders = useMemo(() => {
    if (!universityName) return rawSenders
    const sendersInSelectedUni = new Set<number>()
    for (const m of rawMails) {
      const u = (m.universityName || m.student?.intrestedUniversity || '').toLowerCase().trim()
      if (u === universityName.toLowerCase().trim() && m.sentBy?.id) {
        sendersInSelectedUni.add(Number(m.sentBy.id))
      }
    }
    if (sendersInSelectedUni.size === 0) return rawSenders
    return rawSenders.filter((s) => sendersInSelectedUni.has(s.id))
  }, [rawSenders, rawMails, universityName])

  // Extract distinct target universities from API response + current mails list fallback
  const rawUniversities: string[] = data?.universities || []
  const universitiesSet = new Set<string>(rawUniversities)
  for (const m of rawMails) {
    const uName = m.universityName?.trim() || m.student?.intrestedUniversity?.trim()
    if (uName) {
      universitiesSet.add(uName)
    }
  }
  const universities = Array.from(universitiesSet).sort((a, b) => a.localeCompare(b))

  // Bulletproof filtering for Target University (works both server-side and client-side fallback)
  const mails = universityName
    ? rawMails.filter((m) => {
        const uni = (m.universityName || m.student?.intrestedUniversity || '').toLowerCase().trim()
        return uni === universityName.toLowerCase().trim()
      })
    : rawMails

  const pagination = data?.pagination || { total: 0, page: 1, limit, totalPages: 1 }
  const summary = data?.summary || { totalSent: 0, totalOpened: 0, totalUnopened: 0, openRate: 0, sentToday: 0 }

  const handleResetFilters = () => {
    setSearch('')
    setStatus('all')
    setSentByUserId('')
    setUniversityName('')
    setStartDate('')
    setEndDate('')
    setPage(1)
  }

  const hasActiveFilters = Boolean(search || status !== 'all' || sentByUserId || universityName || startDate || endDate)

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Top Title & Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
              <Mail className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">University Mails</h1>
              <p className="text-sm text-muted-foreground">
                Track, search and monitor all application emails sent to target universities across all students.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Summary KPI Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="p-4 rounded-xl border bg-card text-card-foreground shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Total Sent</p>
            <p className="text-2xl font-bold">{summary.totalSent}</p>
          </div>
          <div className="p-3 rounded-lg bg-blue-500/10 text-blue-600">
            <Send className="h-5 w-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl border bg-card text-card-foreground shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Opened Mails</p>
            <p className="text-2xl font-bold text-emerald-600">{summary.totalOpened}</p>
          </div>
          <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl border bg-card text-card-foreground shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Unopened</p>
            <p className="text-2xl font-bold text-amber-600">{summary.totalUnopened}</p>
          </div>
          <div className="p-3 rounded-lg bg-amber-500/10 text-amber-600">
            <Clock className="h-5 w-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl border bg-card text-card-foreground shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Open Rate</p>
            <p className="text-2xl font-bold text-purple-600">{summary.openRate}%</p>
          </div>
          <div className="p-3 rounded-lg bg-purple-500/10 text-purple-600">
            <Percent className="h-5 w-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl border bg-card text-card-foreground shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sent Today</p>
            <p className="text-2xl font-bold text-indigo-600">{summary.sentToday}</p>
          </div>
          <div className="p-3 rounded-lg bg-indigo-500/10 text-indigo-600">
            <Calendar className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Filter Form Card */}
      <div className="p-4 rounded-xl border bg-card text-card-foreground shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by student name, recipient email, subject, cc..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              className="w-full pl-9 pr-9 py-2 text-sm border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Status Tabs/Buttons */}
          <div className="flex items-center gap-1 bg-muted p-1 rounded-lg self-start lg:self-auto">
            <button
              onClick={() => {
                setStatus('all')
                setPage(1)
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                status === 'all' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All Status
            </button>
            <button
              onClick={() => {
                setStatus('opened')
                setPage(1)
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                status === 'opened' ? 'bg-emerald-500/15 text-emerald-700 font-semibold' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Opened
            </button>
            <button
              onClick={() => {
                setStatus('unopened')
                setPage(1)
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                status === 'unopened' ? 'bg-amber-500/15 text-amber-700 font-semibold' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Unopened
            </button>
          </div>
        </div>

        {/* Advance Filters Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-border/60">
          {/* Target University Filter */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <GraduationCap className="h-3.5 w-3.5" /> Target University
            </label>
            <select
              value={universityName}
              onChange={(e) => {
                setUniversityName(e.target.value)
                setPage(1)
              }}
              className="w-full px-3 py-1.5 text-xs border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">All Target Universities</option>
              {universities.map((uni) => (
                <option key={uni} value={uni}>
                  {uni}
                </option>
              ))}
            </select>
          </div>

          {/* Sent By User Filter */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <UserCheck className="h-3.5 w-3.5" /> Sent By Counsellor
            </label>
            <select
              value={sentByUserId}
              onChange={(e) => {
                setSentByUserId(e.target.value)
                setPage(1)
              }}
              className="w-full px-3 py-1.5 text-xs border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">All Counsellors / Admins</option>
              {senders.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </div>

          {/* Start Date */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" /> From Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value)
                setPage(1)
              }}
              className="w-full px-3 py-1.5 text-xs border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* End Date */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" /> To Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value)
                setPage(1)
              }}
              className="w-full px-3 py-1.5 text-xs border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Clear Filters Button */}
          <div className="flex items-end">
            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                className="w-full px-3 py-1.5 text-xs font-medium border border-destructive/30 text-destructive hover:bg-destructive/10 rounded-md transition-colors flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset Filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Data Table */}
      <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground space-y-3">
            <div className="animate-spin inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
            <p className="text-sm">Loading university application mails...</p>
          </div>
        ) : mails.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
              <Mail className="h-6 w-6" />
            </div>
            <h3 className="text-base font-semibold text-foreground">No application mails found</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {hasActiveFilters
                ? 'No mails matched your current search filters. Try resetting the filters above.'
                : 'No university application emails have been sent yet.'}
            </p>
            {hasActiveFilters && (
              <button
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Student / Recipient</th>
                  <th className="px-4 py-3">To / CC</th>
                  <th className="px-4 py-3">Subject / Program</th>
                  <th className="px-4 py-3">Attached Docs</th>
                  <th className="px-4 py-3">Sent Info</th>
                  <th className="px-4 py-3">Open Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {mails.map((mail) => (
                  <tr key={mail.id} className="hover:bg-muted/40 transition-colors">
                    {/* Student / Recipient */}
                    <td className="px-4 py-3.5">
                      <div className="space-y-0.5">
                        {mail.student ? (
                          <Link
                            to="/app/leads/$leadId"
                            params={{ leadId: String(mail.studentId) }}
                            className="font-semibold text-primary hover:underline flex items-center gap-1 text-sm"
                          >
                            {mail.student.name}
                            <ExternalLink className="h-3 w-3 opacity-60" />
                          </Link>
                        ) : (
                          <span className="font-semibold text-foreground">{mail.recipientName || 'Student'}</span>
                        )}
                        
                      </div>
                    </td>

                    {/* To / CC */}
                    <td className="px-4 py-3.5">
                      <div className="space-y-0.5 text-xs">
                        <p className="font-medium text-foreground">To : {mail.recipientName}</p>
                        <p className="font-medium text-foreground">{mail.toEmail}</p>
                        {mail.cc && <p className="text-muted-foreground">CC: {mail.cc}</p>}
                      </div>
                    </td>

                    {/* Subject / Program */}
                    <td className="px-4 py-3.5 max-w-[280px]">
                      <div className="space-y-0.5">
                        <p className="font-medium text-foreground truncate" title={mail.subject}>
                          {mail.subject || 'Application for Admission'}
                        </p>
                        {(mail.program || mail.student?.intrestedCourse) && (
                          <p className="text-xs font-semibold text-primary truncate" title={mail.program || mail.student?.intrestedCourse}>
                            Program: {mail.program || mail.student?.intrestedCourse}
                          </p>
                        )}
                        {(mail.universityName || mail.student?.intrestedUniversity) && (
                          <p className="text-[11px] text-muted-foreground truncate" title={mail.universityName || mail.student?.intrestedUniversity}>
                            Uni: {mail.universityName || mail.student?.intrestedUniversity}
                          </p>
                        )}
                      </div>
                    </td>

                    {/* Attached Docs */}
                    <td className="px-4 py-3.5">
                      {Array.isArray(mail.attachedDocs) && mail.attachedDocs.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {mail.attachedDocs.map((doc, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200"
                            >
                              <FileText className="h-3 w-3" />
                              {doc}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">No attachments</span>
                      )}
                    </td>

                    {/* Sent Info */}
                    <td className="px-4 py-3.5 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">
                        {new Date(mail.createdAt).toLocaleDateString()} {new Date(mail.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <p>By: {mail.sentBy?.name || mail.senderName || 'System'}</p>
                    </td>

                    {/* Open Status Badge */}
                    <td className="px-4 py-3.5">
                      <button
                        onClick={() => toggleOpenedMutation.mutate(mail.id)}
                        disabled={toggleOpenedMutation.isPending}
                        title="Click to toggle status"
                        className="group text-left transition-transform active:scale-95"
                      >
                        {mail.isOpened ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200 transition-colors">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                              Opened ({mail.openCount})
                            </span>
                            {mail.lastOpenedAt && (
                              <p className="text-[11px] text-muted-foreground">
                                {new Date(mail.lastOpenedAt).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 transition-colors">
                            <Clock className="h-3.5 w-3.5 text-amber-600" />
                            Unopened
                          </span>
                        )}
                      </button>
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3.5 text-right">
                      <button
                        onClick={() => setSelectedMail(mail)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded-md transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5" /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {pagination.totalPages > 1 && (
          <div className="px-4 py-3 border-t bg-muted/30 flex items-center justify-between text-xs text-muted-foreground">
            <div>
              Showing <span className="font-semibold text-foreground">{mails.length}</span> of{' '}
              <span className="font-semibold text-foreground">{pagination.total}</span> mails
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded border bg-background hover:bg-muted disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </button>
              <span className="font-medium text-foreground">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-2.5 py-1 rounded border bg-background hover:bg-muted disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail View Modal */}
      {selectedMail && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-background border rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b flex items-center justify-between bg-muted/40">
              <div>
                <h3 className="font-semibold text-lg text-foreground">{selectedMail.subject || 'Application Mail'}</h3>
                <p className="text-xs text-muted-foreground">
                  Sent on {new Date(selectedMail.createdAt).toLocaleString()} by {selectedMail.sentBy?.name || selectedMail.senderName || 'System'}
                </p>
              </div>
              <button
                onClick={() => setSelectedMail(null)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm">
              {/* Recipient & Metadata Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 rounded-lg bg-muted/30 border">
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase">Recipient To:</span>
                  <p className="font-medium text-foreground">{selectedMail.toEmail}</p>
                  {selectedMail.cc && (
                    <p className="text-xs text-muted-foreground mt-1">
                      <span className="font-semibold">CC:</span> {selectedMail.cc}
                    </p>
                  )}
                </div>

                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase">Recipient Name:</span>
                  <p className="font-semibold text-foreground">{selectedMail.recipientName || 'N/A'}</p>
                </div>

                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase">Student Profile:</span>
                  {selectedMail.student ? (
                    <Link
                      to="/app/students/$studentId"
                      params={{ studentId: String(selectedMail.studentId) }}
                      className="font-medium text-primary hover:underline flex items-center gap-1"
                    >
                      {selectedMail.student.name}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  ) : (
                    <p className="font-medium text-foreground">N/A</p>
                  )}
                </div>

                {(selectedMail.program || selectedMail.student?.intrestedCourse) && (
                  <div>
                    <span className="text-xs font-semibold text-muted-foreground uppercase">Applied Program:</span>
                    <p className="font-semibold text-primary">{selectedMail.program || selectedMail.student?.intrestedCourse}</p>
                  </div>
                )}

                {(selectedMail.universityName || selectedMail.student?.intrestedUniversity) && (
                  <div>
                    <span className="text-xs font-semibold text-muted-foreground uppercase">Target University:</span>
                    <p className="font-semibold text-foreground">{selectedMail.universityName || selectedMail.student?.intrestedUniversity}</p>
                  </div>
                )}
              </div>

              {/* Attachments list */}
              {Array.isArray(selectedMail.attachedDocs) && selectedMail.attachedDocs.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase">Attached Documents:</span>
                  <div className="flex flex-wrap gap-2">
                    {selectedMail.attachedDocs.map((doc, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-800 border border-blue-200"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        {doc}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Email Content Box */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase">Email Body Content:</span>
                <div
                  className="p-4 rounded-lg border bg-white text-black min-h-[160px] max-h-[350px] overflow-y-auto prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: selectedMail.body }}
                />
              </div>

              {/* Tracking Telemetry Info Box */}
              <div className="p-4 rounded-lg border bg-emerald-50/50 border-emerald-200 text-emerald-950 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Open Tracking Telemetry
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleOpenedMutation.mutate(selectedMail.id)}
                      disabled={toggleOpenedMutation.isPending}
                      className="px-2.5 py-1 text-xs font-semibold rounded-md border bg-background hover:bg-muted text-foreground transition-colors shadow-sm"
                    >
                      {selectedMail.isOpened ? 'Mark as Unopened' : 'Mark as Opened'}
                    </button>
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-200 text-emerald-900">
                      {selectedMail.isOpened ? `Opened (${selectedMail.openCount} times)` : 'Unopened'}
                    </span>
                  </div>
                </div>
                {selectedMail.isOpened && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1 border-t border-emerald-200/80">
                    <div>
                      <span className="text-muted-foreground">First Opened:</span>{' '}
                      <span className="font-medium">
                        {selectedMail.firstOpenedAt ? new Date(selectedMail.firstOpenedAt).toLocaleString() : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Last Opened:</span>{' '}
                      <span className="font-medium">
                        {selectedMail.lastOpenedAt ? new Date(selectedMail.lastOpenedAt).toLocaleString() : 'N/A'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t bg-muted/30 flex justify-end">
              <button
                onClick={() => setSelectedMail(null)}
                className="px-4 py-2 text-xs font-medium bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors"
              >
                Close Window
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
