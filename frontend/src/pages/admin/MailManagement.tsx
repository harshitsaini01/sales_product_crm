import { useEffect, useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  leadsApi,
  communicationApi,
  leadConfigApi,
  campaignsApi,
  inboxApi,
  type FilterOptionsResponse,
} from '@/lib/api'
import { MultiSelectFilter } from '@/components/common/MultiSelectFilter'
import { useAuthStore } from '@/stores/auth.store'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import {
  Mail,
  Send,
  Users,
  Search,
  Filter,
  Loader2,
  CheckSquare,
  Square,
  Inbox as InboxIcon,
  History,
  RefreshCw,
  Trash2,
  Mail as MailUnreadIcon,
  MailOpen,
  Rocket,
  X,
  Pause,
  Play,
  StopCircle,
  BarChart3,
  Eye,
  FileText,
  Pencil,
  Server,
  Reply as ReplyIcon,
  ChevronLeft,
} from 'lucide-react'
import { TemplatesTab, SignaturesTab, HtmlPreview, ProductInsertBar } from './Communication'
import { EmailAccountsTab } from './CampaignGroups'
import { CopyButton, LeadLinkChip } from '@/components/common/MailRowBits'
import { downloadBlob } from '@/lib/utils'
import {
  XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer,
  CartesianGrid, Legend, BarChart, Bar,
} from 'recharts'

type Tab = 'compose' | 'campaigns' | 'history' | 'inbox' | 'reports' | 'templates' | 'signatures' | 'accounts'

interface Lead {
  id: number
  name: string
  email: string | null
  mobile: string | null
  leadStatus: string | null
  departmentId: number | null
  website: string | null
}

interface SentMail {
  id: number
  toEmail: string
  subject: string
  body: string
  status: string  // 'sent' | 'failed' | 'pending'
  createdAt: string
  leadId?: number | null
  user?: { id: number; name: string } | null
  openedAt?: string | null
  repliedAt?: string | null
  errorMessage?: string | null
  group?: { id: number; name: string; fromEmail: string } | null
  // Which pipeline produced this row. 'direct' = quick send from the Compose
  // tab (SentMail); 'campaign' = a scheduled campaign recipient
  // (EmailCampaignRecipient). Tag drives the badge shown in the history list.
  source?: 'direct' | 'campaign'
  campaignId?: number | null
  campaignName?: string | null
}


function mailUrlParam(key: string, fallback = ''): string {
  if (typeof window === 'undefined') return fallback
  return new URLSearchParams(window.location.search).get(key) || fallback
}

export default function MailManagement() {
  // Honor ?tab= from the URL — the retired /app/campaign-groups redirect passes
  // ?tab=accounts, and links inside the app may deep-link to a specific tab.
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'compose'
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t && ['compose', 'campaigns', 'history', 'inbox', 'reports', 'templates', 'signatures', 'accounts'].includes(t)) {
      return t as Tab
    }
    return 'compose'
  })

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('tab', tab)
    window.history.replaceState(null, '', url)
  }, [tab])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Mail className="h-6 w-6 text-primary" />
          Mail Management
        </h1>
      </div>

      <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-lg w-fit">
        <button
          onClick={() => setTab('inbox')}
          className={`px-4 py-1.5 text-sm font-semibold rounded transition-colors flex items-center gap-1.5 ${
            tab === 'inbox' ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <InboxIcon className="h-3.5 w-3.5" />
          Inbox
        </button>
        <button
          onClick={() => setTab('compose')}
          className={`px-4 py-1.5 text-sm font-semibold rounded transition-colors flex items-center gap-1.5 ${
            tab === 'compose' ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Send className="h-3.5 w-3.5" />
          Compose & Send
        </button>
        <button
          onClick={() => setTab('campaigns')}
          className={`px-4 py-1.5 text-sm font-semibold rounded transition-colors flex items-center gap-1.5 ${
            tab === 'campaigns' ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Rocket className="h-3.5 w-3.5" />
          Campaigns
        </button>
        <button
          onClick={() => setTab('reports')}
          className={`px-4 py-1.5 text-sm font-semibold rounded transition-colors flex items-center gap-1.5 ${
            tab === 'reports' ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Reports
        </button>
        <button
          onClick={() => setTab('history')}
          className={`px-4 py-1.5 text-sm font-semibold rounded transition-colors flex items-center gap-1.5 ${
            tab === 'history' ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <History className="h-3.5 w-3.5" />
          Sent History
        </button>
        <button
          onClick={() => setTab('templates')}
          className={`px-4 py-1.5 text-sm font-semibold rounded transition-colors flex items-center gap-1.5 ${
            tab === 'templates' ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          Templates
        </button>
        <button
          onClick={() => setTab('signatures')}
          className={`px-4 py-1.5 text-sm font-semibold rounded transition-colors flex items-center gap-1.5 ${
            tab === 'signatures' ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Pencil className="h-3.5 w-3.5" />
          Signatures
        </button>
        <button
          onClick={() => setTab('accounts')}
          className={`px-4 py-1.5 text-sm font-semibold rounded transition-colors flex items-center gap-1.5 ${
            tab === 'accounts' ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Server className="h-3.5 w-3.5" />
          Email Accounts
        </button>
      </div>

      {tab === 'inbox' ? <InboxTab />
        : tab === 'compose' ? <ComposeTab />
        : tab === 'campaigns' ? <CampaignsTab />
        : tab === 'reports' ? <ReportsTab />
        : tab === 'templates' ? <div className="bg-card border rounded-xl p-5"><TemplatesTab /></div>
        : tab === 'signatures' ? <div className="bg-card border rounded-xl p-5"><SignaturesTab /></div>
        : tab === 'accounts' ? <div className="bg-card border rounded-xl p-5"><EmailAccountsTab /></div>
        : <HistoryTab />}
    </div>
  )
}

// ─── Compose Tab ──────────────────────────────────────────────────────────────

function ComposeTab() {
  const qc = useQueryClient()

  // Filter state
  const [search, setSearch] = useState(() => mailUrlParam('search'))
  const [departmentId, setDepartmentId] = useState(() => mailUrlParam('departmentId'))
  const [leadStatusId, setLeadStatusId] = useState(() => mailUrlParam('leadStatusId'))
  const [leadSubStatusId, setLeadSubStatusId] = useState(() => mailUrlParam('leadSubStatusId'))
  const [website, setWebsite] = useState(() => mailUrlParam('website'))
  const [source, setSource] = useState(() => mailUrlParam('source'))
  const [country, setCountry] = useState(() => mailUrlParam('country'))
  const [city, setCity] = useState(() => mailUrlParam('city'))
  const [intrestedCourse, setIntrestedCourse] = useState(() => mailUrlParam('intrestedCourse'))
  // Lead-type "bucket" inside the picked department — mirrors the Leads page's
  // tabs above the list. Only makes sense once a department is chosen; picking
  // a new department clears it (below).
  const [statusLeadTypeId, setStatusLeadTypeId] = useState(() => mailUrlParam('statusLeadTypeId'))
  const [fromDate, setFromDate] = useState(() => mailUrlParam('fromDate'))
  const [toDate, setToDate] = useState(() => mailUrlParam('toDate'))
  const [page, setPage] = useState(() => Math.max(1, Number(mailUrlParam('page', '1')) || 1))
  const [limit, setLimit] = useState(() => [50, 100, 200, 500].includes(Number(mailUrlParam('limit', '50'))) ? Number(mailUrlParam('limit', '50')) : 50)

  // Selection
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // A selection belongs only to the current recipient bucket. Changing any
  // filter starts a new bucket, so never carry old recipients into it.
  useEffect(() => {
    setSelected(new Set())
  }, [search, departmentId, leadStatusId, leadSubStatusId, website, source, country, city, intrestedCourse, statusLeadTypeId, fromDate, toDate])

  // Compose
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [signatureId, setSignatureId] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState('')
  // Which email account this compose sends from. Defaults to the first active
  // account (decision B option 1) as soon as accounts load — see effect below.
  // Empty string means "use the .env default SMTP" (pre-accounts fallback).
  const [showSchedule, setShowSchedule] = useState(false)
  const [sendFlow, setSendFlow] = useState<'preview' | 'recipients' | null>(null)

  useEffect(() => {
    const url = new URL(window.location.href)
    const values: Record<string, string> = {
      page: String(page), limit: String(limit), search, departmentId, leadStatusId, leadSubStatusId,
      website, source, country, city, intrestedCourse, statusLeadTypeId, fromDate, toDate,
    }
    for (const [key, value] of Object.entries(values)) {
      if (value && !((key === 'page' && value === '1') || (key === 'limit' && value === '50'))) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    }
    window.history.replaceState(null, '', url)
  }, [page, limit, search, departmentId, leadStatusId, leadSubStatusId, website, source, country, city, intrestedCourse, statusLeadTypeId, fromDate, toDate])

  // ── Filter options ──
  // Full config catalog (all rows, all departments) — cascading below narrows
  // it down. Matches how the TaskBuilder screen fetches them, so both flows
  // hit the same cache and reuse the same row shape.
  const { data: departments = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ['lead-config', 'departments'],
    queryFn: leadConfigApi.departments,
  })
  const { data: leadTypesAll = [] } = useQuery<{ id: number; title: string; departmentId: number | null }[]>({
    queryKey: ['lead-config', 'types'],
    queryFn: leadConfigApi.types,
  })
  const { data: statuses = [] } = useQuery<{ id: number; title: string; departmentId: number | null }[]>({
    queryKey: ['lead-config', 'statuses'],
    queryFn: leadConfigApi.statuses,
  })
  // Fetch ALL sub-statuses once (not scoped to a status) so we can scope client-
  // side by whatever status is picked, and validate/prune when the status
  // changes. Matches TaskBuilder's approach.
  const { data: subStatusesAll = [] } = useQuery<{ id: number; subStatus: string; statusId: number | null }[]>({
    queryKey: ['lead-config', 'sub-statuses', 'all'],
    queryFn: () => leadConfigApi.subStatuses(),
  })
  const { data: templates = [] } = useQuery<{ id: number; title: string; subject: string; body: string }[]>({
    queryKey: ['comm', 'templates'],
    queryFn: communicationApi.templates,
  })
  const { data: signatures = [] } = useQuery<{ id: number; title: string; content?: string; isDefault?: boolean }[]>({
    queryKey: ['comm', 'signatures'],
    queryFn: communicationApi.signatures,
  })
  const { data: campaignGroups = [] } = useQuery<{ id: number; name: string; fromName: string; fromEmail: string; authorityScore: number; hourlyCap: number; isActive: boolean }[]>({
    queryKey: ['campaigns', 'groups'],
    queryFn: campaignsApi.groups,
  })
  // Fetch the same letterhead the backend prepends to every send so the compose
  // preview and the real message stay in sync — no drift when the letterhead changes.
  const { data: brand } = useQuery<{ letterhead: string }>({
    queryKey: ['comm', 'brand'],
    queryFn: communicationApi.brand,
    staleTime: 60 * 60 * 1000,
  })
  // Real values pulled from the leads table so the dropdowns show only options
  // that actually exist in the current data — no guessing hard-coded lists.
  const { data: filterOptions } = useQuery<FilterOptionsResponse>({
    queryKey: ['leads', 'filter-options', 'mail'],
    queryFn: () => leadsApi.filterOptions(),
    staleTime: 5 * 60 * 1000,
  })
  const toOptions = (values: string[] | undefined) => (values || []).map((v) => ({ value: v, count: 0 }))

  // ── Pipeline cascade (Department → Lead Type / Status → Sub-Status) ──
  // Mirrors the TaskBuilder screen so both places treat the same shape of
  // dropdowns consistently. Options are stored as config ids, and each level
  // narrows to children of the level above it.
  const typesForDept = useMemo(() => {
    if (!departmentId) return leadTypesAll
    return leadTypesAll.filter((t) => String(t.departmentId ?? '') === departmentId)
  }, [leadTypesAll, departmentId])
  const statusesForDept = useMemo(() => {
    if (!departmentId) return statuses
    return statuses.filter((s) => String(s.departmentId ?? '') === departmentId)
  }, [statuses, departmentId])
  const subStatusesForStatus = useMemo(() => {
    if (leadStatusId) return subStatusesAll.filter((s) => String(s.statusId ?? '') === leadStatusId)
    if (departmentId) {
      // No status picked but a dept is — keep sub-statuses whose parent status
      // belongs to the picked department. Prevents a Counselling sub-status from
      // showing while the NEET department is scoped.
      const statusById = new Map(statuses.map((s) => [String(s.id), s]))
      return subStatusesAll.filter((sub) => {
        const parent = statusById.get(String(sub.statusId ?? ''))
        return parent && String(parent.departmentId ?? '') === departmentId
      })
    }
    return subStatusesAll
  }, [subStatusesAll, statuses, departmentId, leadStatusId])

  // Cascade prune helpers. Change dept → drop any type/status/sub-status that
  // belonged to the old dept; change status → drop any sub-status whose parent
  // no longer matches. Keeps the recipient count honest at every step instead
  // of quietly filtering by a stale id from a different department.
  const changeDepartment = (id: string) => {
    setDepartmentId(id)
    setPage(1)
    // Prune Lead Type
    if (statusLeadTypeId && id && !typesForDept.some((t) => String(t.id) === statusLeadTypeId && String(t.departmentId ?? '') === id)) {
      setStatusLeadTypeId('')
    }
    // Prune Status (and sub-status with it)
    if (leadStatusId && id) {
      const still = statuses.find((s) => String(s.id) === leadStatusId && String(s.departmentId ?? '') === id)
      if (!still) { setLeadStatusId(''); setLeadSubStatusId('') }
    }
  }
  const changeStatus = (id: string) => {
    setLeadStatusId(id)
    setPage(1)
    // Sub-status must be a child of the newly picked status.
    if (leadSubStatusId && id) {
      const still = subStatusesAll.find((s) => String(s.id) === leadSubStatusId && String(s.statusId ?? '') === id)
      if (!still) setLeadSubStatusId('')
    } else if (leadSubStatusId && !id) {
      // Clearing status → clear sub-status too (matches TaskBuilder behaviour).
      setLeadSubStatusId('')
    }
  }

  // Set default signature
  useMemo(() => {
    if (!signatureId && signatures.length > 0) {
      const def = signatures.find((s) => s.isDefault)
      if (def) setSignatureId(String(def.id))
    }
  }, [signatures, signatureId])

  // Default the Send-from picker to the first ACTIVE account as soon as
  // accounts load — matches decision B (option 1). Once the user picks
  // something else this stays out of the way.
  // ── Build params + query leads ──
  const params = useMemo(() => {
    const p: Record<string, string> = { page: String(page), limit: String(limit) }
    if (search) p.search = search
    if (departmentId) p.departmentId = departmentId
    if (leadStatusId) p.leadStatusId = leadStatusId
    if (leadSubStatusId) p.leadSubStatusId = leadSubStatusId
    if (website) p.website = website
    if (source) p.source = source
    if (country) p.country = country
    if (city) p.city = city
    if (intrestedCourse) p.intrestedCourse = intrestedCourse
    if (statusLeadTypeId) p.statusLeadTypeId = statusLeadTypeId
    if (fromDate) p.fromDate = fromDate
    if (toDate) p.toDate = toDate
    p.hasEmail = '1' // always require email since we're emailing
    return p
  }, [search, departmentId, leadStatusId, leadSubStatusId, website, source, country, city, intrestedCourse, statusLeadTypeId, fromDate, toDate, page, limit])

  const { data: leadsData, isLoading, refetch, isFetching } = useQuery<{
    data: Lead[]
    total: number
    totalPages: number
  }>({
    queryKey: ['mail-leads', params],
    queryFn: () => leadsApi.list(params),
  })

  const leads = leadsData?.data || []
  const total = leadsData?.total || 0
  const totalPages = leadsData?.totalPages || 1
  const leadsWithEmail = leads.filter((l) => l.email)

  // ── Selection handlers ──
  const toggleOne = (id: number) => {
    setSelected((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  const togglePage = () => {
    if (leadsWithEmail.every((l) => selected.has(l.id))) {
      setSelected((p) => {
        const n = new Set(p)
        leadsWithEmail.forEach((l) => n.delete(l.id))
        return n
      })
    } else {
      setSelected((p) => {
        const n = new Set(p)
        leadsWithEmail.forEach((l) => n.add(l.id))
        return n
      })
    }
  }
  const clearSelection = () => setSelected(new Set())

  // "Select all matching" — pulls every lead id across every page for the
  // current filter set, not just the ones rendered on screen. Uses the same
  // /leads endpoint with limit=total so the response matches the pager count
  // exactly. A single roundtrip is fine even at ~60k leads (id + email +
  // basic fields per row), and we already require hasEmail=1 in `params`.
  const [selectingAll, setSelectingAll] = useState(false)
  const selectAllMatching = async () => {
    if (total === 0 || selectingAll) return
    // Very large audiences: 100k+ leads in one shot is a lot of JSON. Warn
    // once so a stray click on a broad filter can't silently pull the whole DB.
    if (total > 20000 && !confirm(`Select all ${total.toLocaleString()} matching leads across every page? This may take a few seconds.`)) return
    setSelectingAll(true)
    try {
      const allParams: Record<string, string> = { ...params, page: '1', limit: String(total) }
      const resp = await leadsApi.list(allParams) as { data: Lead[] }
      const ids = (resp.data || []).filter((l) => l.email).map((l) => l.id)
      setSelected(new Set(ids))
      toast.success(`Selected ${ids.length.toLocaleString()} lead${ids.length === 1 ? '' : 's'} with email`)
    } catch (e) {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || 'Failed to select all matching leads')
    } finally {
      setSelectingAll(false)
    }
  }

  const allSelectedOnPage =
    leadsWithEmail.length > 0 && leadsWithEmail.every((l) => selected.has(l.id))

  // ── Apply template ──
  const applyTemplate = (id: string) => {
    setTemplateId(id)
    if (!id) return
    const tpl = templates.find((t) => String(t.id) === id)
    if (tpl) {
      setSubject(tpl.subject || '')
      setBody(tpl.body || '')
    }
  }

  // ── Send mutations ──
  const sendSelected = useMutation({
    mutationFn: () =>
      communicationApi.sendBulk({
        leadIds: Array.from(selected),
        subject,
        body,
        cc,
        bcc,
        signatureId: signatureId ? Number(signatureId) : undefined,
        groupId: selectedGroupId ? Number(selectedGroupId) : undefined,
      }),
    onSuccess: (r: any) => {
      toast.success(r?.message || `Sent to ${selected.size} leads`)
      qc.invalidateQueries({ queryKey: ['comm', 'sent'] })
      setSubject('')
      setBody('')
      setCc('')
      setBcc('')
      setTemplateId('')
      clearSelection()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Send failed'),
  })

  /* const hasAnyFilter = !!(search || departmentId || leadStatusId || leadSubStatusId || website || source || country || city || intrestedCourse || statusLeadTypeId || fromDate || toDate)
  const sendAllByFilter = useMutation({
    mutationFn: () =>
      communicationApi.sendBulkByFilter({
        subject,
        body,
        cc,
        bcc,
        signatureId: signatureId ? Number(signatureId) : undefined,
        departmentId: departmentId ? Number(departmentId) : undefined,
        leadStatusId: leadStatusId ? Number(leadStatusId) : undefined,
        leadSubStatusId: leadSubStatusId ? Number(leadSubStatusId) : undefined,
        statusLeadTypeId: statusLeadTypeId ? Number(statusLeadTypeId) : undefined,
        website: website || undefined,
        source: source || undefined,
        country: country || undefined,
        city: city || undefined,
        intrestedCourse: intrestedCourse || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        search: search || undefined,
        // Only opt into "everyone" when nothing narrows the list — otherwise
        // the backend uses whatever filters are set. Guards against a stray
        // click sending to the whole database.
        all: !hasAnyFilter,
      }),
    onSuccess: (r: any) => {
      toast.success(r?.message || 'Bulk send complete')
      qc.invalidateQueries({ queryKey: ['comm', 'sent'] })
      setSubject('')
      setBody('')
      setCc('')
      setBcc('')
      setTemplateId('')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Send failed'),
  }) */

  const canSend = !!subject.trim() && !!body.trim() && !!selectedGroupId
  const selectedLeads = Array.from(selected).map((id) =>
    leads.find((lead) => lead.id === id) || { id, name: `Lead #${id}`, email: null },
  )
  const selectedGroup = campaignGroups.find((group) => String(group.id) === selectedGroupId)
  const senderEmail = selectedGroup?.fromEmail || ''
  const senderName = selectedGroup?.fromName || ''
  const startSendFlow = () => setSendFlow('preview')
  const confirmSend = () => {
    setSendFlow(null)
    sendSelected.mutate()
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* ── Left: filter + recipient list ── */}
      <div className="lg:col-span-3 space-y-4">
        <div className="bg-card border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Recipient Filters
            </span>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="ml-auto p-1 rounded hover:bg-muted disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search by name / email / mobile..."
              className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-background"
            />
          </div>

          {/*
            Pipeline cascade — same shape as the Task Assignment page:
              Department → Lead Type → Status → Sub-Status.
            Each dropdown only shows children of the pick above it, and picking
            a parent prunes any orphaned child that was set from a different
            branch (see changeDepartment / changeStatus). Labels show a
            "· in selected dept/status" hint whenever the list is scoped, so it
            is obvious *why* something isn't in the list.
          */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Department</label>
              <select
                value={departmentId}
                onChange={(e) => changeDepartment(e.target.value)}
                className="w-full mt-1 px-2 py-1.5 text-sm border rounded-lg bg-background"
              >
                <option value="">Any department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Lead Type{departmentId && <span className="ml-1 font-normal normal-case text-[9px]">· in selected dept</span>}
              </label>
              <select
                value={statusLeadTypeId}
                onChange={(e) => { setStatusLeadTypeId(e.target.value); setPage(1) }}
                className="w-full mt-1 px-2 py-1.5 text-sm border rounded-lg bg-background"
              >
                <option value="">Any lead type</option>
                {typesForDept.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Status{departmentId && <span className="ml-1 font-normal normal-case text-[9px]">· in selected dept</span>}
              </label>
              <select
                value={leadStatusId}
                onChange={(e) => changeStatus(e.target.value)}
                className="w-full mt-1 px-2 py-1.5 text-sm border rounded-lg bg-background"
              >
                <option value="">Any status</option>
                {statusesForDept.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Sub-Status{leadStatusId && <span className="ml-1 font-normal normal-case text-[9px]">· in selected status</span>}
              </label>
              <select
                value={leadSubStatusId}
                onChange={(e) => { setLeadSubStatusId(e.target.value); setPage(1) }}
                className="w-full mt-1 px-2 py-1.5 text-sm border rounded-lg bg-background"
              >
                <option value="">Any sub-status</option>
                {subStatusesForStatus.map((s) => (
                  <option key={s.id} value={s.id}>{s.subStatus}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <MultiSelectFilter
              label="Website"
              value={website}
              onChange={(v) => { setWebsite(v); setPage(1) }}
              options={toOptions(filterOptions?.websites)}
              placeholder="All Websites"
            />
            <MultiSelectFilter
              label="Source"
              value={source}
              onChange={(v) => { setSource(v); setPage(1) }}
              options={toOptions(filterOptions?.sources)}
              placeholder="All Sources"
            />
            <MultiSelectFilter
              label="Country"
              value={country}
              onChange={(v) => { setCountry(v); setPage(1) }}
              options={toOptions(filterOptions?.countries)}
              placeholder="All Countries"
            />
            <MultiSelectFilter
              label="City"
              value={city}
              onChange={(v) => { setCity(v); setPage(1) }}
              options={toOptions(filterOptions?.cities)}
              placeholder="All Cities"
            />
          </div>

          {/* Interested Course spans one row on its own — it's usually a much
              longer list than website/country/city, so a full-width dropdown
              is easier to scan. */}
          <div className="grid grid-cols-1 gap-2">
            <MultiSelectFilter
              label={`Product interest${filterOptions?.courses?.length ? ` · ${filterOptions.courses.length} available` : ''}`}
              value={intrestedCourse}
              onChange={(v) => { setIntrestedCourse(v); setPage(1) }}
              options={toOptions(filterOptions?.courses)}
              placeholder="All Courses"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value)
                setPage(1)
              }}
              className="px-2 py-1.5 text-sm border rounded-lg bg-background"
              title="Created from"
            />
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value)
                setPage(1)
              }}
              className="px-2 py-1.5 text-sm border rounded-lg bg-background"
              title="Created to"
            />
          </div>

          {/* Active-filter chip row. Each chip clears just its own filter — the
              user sees at a glance what's narrowing the list and can drop any
              one piece without touching the others. */}
          {(() => {
            const chips: { key: string; label: string; onClear: () => void }[] = []
            const pushMulti = (key: string, value: string, onClear: () => void) => {
              if (!value) return
              const parts = value.split(',').filter(Boolean)
              chips.push({ key, label: `${key}: ${parts.length > 1 ? `${parts.length} selected` : parts[0]}`, onClear })
            }
            if (search) chips.push({ key: 'search', label: `Search: ${search}`, onClear: () => setSearch('') })
            if (departmentId) chips.push({ key: 'dept', label: `Dept: ${departments.find((d) => String(d.id) === departmentId)?.name || departmentId}`, onClear: () => changeDepartment('') })
            if (statusLeadTypeId) chips.push({ key: 'ltype', label: `Type: ${leadTypesAll.find((t) => String(t.id) === statusLeadTypeId)?.title || statusLeadTypeId}`, onClear: () => setStatusLeadTypeId('') })
            if (leadStatusId) chips.push({ key: 'status', label: `Status: ${statuses.find((s) => String(s.id) === leadStatusId)?.title || leadStatusId}`, onClear: () => changeStatus('') })
            if (leadSubStatusId) chips.push({ key: 'sub', label: `Sub: ${subStatusesAll.find((s) => String(s.id) === leadSubStatusId)?.subStatus || leadSubStatusId}`, onClear: () => setLeadSubStatusId('') })
            pushMulti('Website', website, () => setWebsite(''))
            pushMulti('Source', source, () => setSource(''))
            pushMulti('Country', country, () => setCountry(''))
            pushMulti('City', city, () => setCity(''))
            pushMulti('Course', intrestedCourse, () => setIntrestedCourse(''))
            if (fromDate || toDate) chips.push({ key: 'date', label: `Date: ${fromDate || '…'} → ${toDate || '…'}`, onClear: () => { setFromDate(''); setToDate('') } })
            if (chips.length === 0) return null
            return (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {chips.map((chip) => (
                  <span key={chip.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
                    {chip.label}
                    <button onClick={() => { chip.onClear(); setPage(1) }} className="hover:text-destructive"><X className="h-3 w-3" /></button>
                  </span>
                ))}
                <button
                  onClick={() => {
                    setSearch(''); setDepartmentId(''); setLeadStatusId(''); setLeadSubStatusId('')
                    setWebsite(''); setSource(''); setCountry(''); setCity('')
                    setIntrestedCourse(''); setStatusLeadTypeId('')
                    setFromDate(''); setToDate('')
                    setPage(1)
                  }}
                  className="text-[11px] text-destructive font-semibold hover:underline ml-1"
                >
                  Clear all
                </button>
              </div>
            )
          })()}
        </div>

        {/* ── Recipient list ── */}
        <div className="bg-card border rounded-xl">
          <div className="px-4 py-2.5 border-b flex items-center gap-3 bg-muted/30 text-xs flex-wrap">
            <button
              onClick={togglePage}
              className="flex items-center gap-1.5 font-semibold hover:text-primary"
              disabled={leadsWithEmail.length === 0}
            >
              {allSelectedOnPage ? (
                <CheckSquare className="h-4 w-4 text-primary" />
              ) : (
                <Square className="h-4 w-4 text-muted-foreground" />
              )}
              Select page
            </button>
            <button
              onClick={selectAllMatching}
              disabled={total === 0 || selectingAll || selected.size === total}
              className="flex items-center gap-1.5 font-semibold text-primary hover:underline disabled:opacity-40 disabled:no-underline"
              title="Select every lead matching the current filters — across all pages"
            >
              {selectingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckSquare className="h-3.5 w-3.5" />
              )}
              Select all {total > 0 ? `(${total.toLocaleString()})` : ''}
            </button>
            <span className="text-muted-foreground">
              {total.toLocaleString()} total · <strong className="text-foreground">{selected.size.toLocaleString()} selected</strong>
            </span>
            <div className="ml-auto flex items-center gap-2">
              <label className="text-muted-foreground">Per page</label>
              <select
                value={limit}
                onChange={(e) => { setLimit(Number(e.target.value)); setPage(1) }}
                className="px-2 py-1 text-xs border rounded bg-background"
              >
                {[50, 100, 200, 500].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              {selected.size > 0 && (
                <button
                  onClick={clearSelection}
                  className="text-destructive font-semibold hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[460px] overflow-y-auto divide-y">
            {isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : leads.length === 0 ? (
              <p className="text-center py-10 text-sm text-muted-foreground">
                No leads match these filters.
              </p>
            ) : (
              leads.map((lead) => {
                const checked = selected.has(lead.id)
                const noEmail = !lead.email
                return (
                  <label
                    key={lead.id}
                    className={`flex items-center gap-3 px-4 py-2.5 hover:bg-accent/30 cursor-pointer ${
                      noEmail ? 'opacity-50' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => !noEmail && toggleOne(lead.id)}
                      disabled={noEmail}
                      className="rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{lead.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {lead.email || <span className="italic">no email</span>}
                        {lead.mobile && ` · ${lead.mobile}`}
                      </div>
                    </div>
                    {lead.leadStatus && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold">
                        {lead.leadStatus}
                      </span>
                    )}
                  </label>
                )
              })
            )}
          </div>

          {totalPages > 1 && (
            <div className="px-4 py-2 border-t flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-accent"
                >
                  Prev
                </button>
                {(() => {
                  const start = Math.max(1, Math.min(page - 2, totalPages - 4))
                  const end = Math.min(totalPages, start + 4)
                  return Array.from({ length: end - start + 1 }, (_, index) => start + index).map((pageNumber) => (
                    <button
                      key={pageNumber}
                      onClick={() => setPage(pageNumber)}
                      aria-current={pageNumber === page ? 'page' : undefined}
                      className={`min-w-7 px-2 py-1 border rounded ${pageNumber === page ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'}`}
                    >
                      {pageNumber}
                    </button>
                  ))
                })()}
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-accent"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Compose ── */}
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-card border rounded-xl p-4 space-y-3">
          <SenderPicker
            groups={campaignGroups.filter((group) => group.isActive)}
            value={selectedGroupId}
            onChange={setSelectedGroupId}
          />

          <div className="grid grid-cols-2 gap-2">
            <select
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              className="px-2 py-1.5 text-sm border rounded-lg bg-background"
            >
              <option value="">— Template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <select
              value={signatureId}
              onChange={(e) => setSignatureId(e.target.value)}
              className="px-2 py-1.5 text-sm border rounded-lg bg-background"
            >
              <option value="">— Signature —</option>
              {signatures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} {s.isDefault ? '(default)' : ''}
                </option>
              ))}
            </select>
          </div>

          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="w-full px-3 py-2 text-sm border rounded-lg bg-background font-semibold"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="CC (comma separated)"
              className="px-3 py-2 text-sm border rounded-lg bg-background"
            />
            <input
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              placeholder="BCC (comma separated)"
              className="px-3 py-2 text-sm border rounded-lg bg-background"
            />
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            placeholder="HTML body. Use {{name}} to personalize per recipient."
            className="w-full px-3 py-2 text-sm border rounded-lg bg-background resize-none font-mono"
          />
          <ProductInsertBar body={body} onChange={setBody} />

          <ComposePreview
            subject={subject}
            body={body}
            signatureId={signatureId}
            signatures={signatures}
            letterhead={brand?.letterhead ?? ''}
            sampleLead={
              // Pull a real recipient so {{name}} in the preview resolves to
              // an actual name instead of the literal token — same substitution
              // rule the server uses when it sends. Prefers a selected lead so
              // "who am I writing to?" matches the checkbox state.
              leads.find((l) => selected.has(l.id) && l.email) ||
              leads.find((l) => l.email) ||
              null
            }
          />

          <div className="text-[11px] text-muted-foreground">
            Tip: <code>{`{{name}}`}</code>, <code>{`{{firstName}}`}</code>, and <code>{`{{email}}`}</code> get replaced per recipient. Preview shows the email exactly as recipients will see it — letterhead, body, signature.
          </div>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => setShowSchedule(true)}
            disabled={!canSend || selected.size === 0}
            className="w-full py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Rocket className="h-4 w-4" />
            Schedule Campaign ({selected.size})
          </button>

          <button
            onClick={startSendFlow}
            disabled={!canSend || selected.size === 0 || sendSelected.isPending}
            className="w-full py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
            title="Send immediately via the legacy single-SMTP path (no chunking, no auto-distribute)"
          >
            {sendSelected.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Quick send to {selected.size.toLocaleString()} selected lead{selected.size === 1 ? '' : 's'} (Immediate)
          </button>

          {/* <button
            onClick={() => startSendFlow('filter')}
            disabled={!canSend || sendAllByFilter.isPending}
            className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
          >
            {sendAllByFilter.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Users className="h-4 w-4" />
            )}
            Send to ALL by Filter (~{total})
          </button> */}
        </div>
      </div>

      {showSchedule && (
        <ScheduleCampaignModal
          subject={subject}
          bodyHtml={body}
          signatureId={signatureId ? Number(signatureId) : null}
          leadIds={Array.from(selected)}
          activeGroups={campaignGroups.filter((g) => g.isActive)}
          defaultGroupId={selectedGroupId ? Number(selectedGroupId) : null}
          onClose={() => setShowSchedule(false)}
          onScheduled={() => {
            setShowSchedule(false)
            clearSelection()
            setSubject('')
            setBody('')
            setTemplateId('')
            qc.invalidateQueries({ queryKey: ['campaigns', 'list'] })
            toast.success('Campaign scheduled — engine will start dripping shortly')
          }}
        />
      )}

      {sendFlow === 'preview' && (
        <FullMailPreviewModal
          subject={subject}
          body={body}
          signatureId={signatureId}
          signatures={signatures}
          letterhead={brand?.letterhead ?? ''}
          sampleLead={selectedLeads[0] || leads.find((lead) => lead.email) || null}
          senderName={senderName}
          senderEmail={senderEmail}
          recipientCount={selected.size}
          onClose={() => setSendFlow(null)}
          onContinue={() => setSendFlow('recipients')}
        />
      )}

      {sendFlow === 'recipients' && (
        <RecipientConfirmationModal
          leads={selectedLeads}
          total={selected.size}
          isFilter={false}
          pending={sendSelected.isPending}
          senderEmail={senderEmail}
          onBack={() => setSendFlow('preview')}
          onClose={() => setSendFlow(null)}
          onConfirm={confirmSend}
        />
      )}
    </div>
  )
}

// ─── Sender Picker ────────────────────────────────────────────────────────────
// Which email account this compose sends from. Empty value = fall back to the
// SMTP_FROM in .env — matches the pre-accounts behaviour so nothing breaks if
// no account has been configured yet. Only ACTIVE accounts appear.

export function SenderPicker({
  groups,
  value,
  onChange,
}: {
  groups: { id: number; name: string; fromName: string; fromEmail: string }[]
  value: string
  onChange: (v: string) => void
}) {
  if (groups.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
        <div className="font-semibold mb-0.5">No email accounts configured.</div>
        Add an active account under <strong>Email Accounts</strong> before sending.
      </div>
    )
  }
  const picked = groups.find((g) => String(g.id) === value)
  return (
    <div className="bg-violet-50/60 border border-violet-200 rounded-lg px-3 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-violet-900">Send from</span>
        <span className="text-[11px] text-violet-700">
          {picked ? `Recipients will see: "${picked.fromName}" <${picked.fromEmail}>` : 'Select one of your added email accounts'}
        </span>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 text-sm border rounded bg-background"
      >
        <option value="">Select sending email</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name} — {g.fromEmail}
          </option>
        ))}
      </select>
    </div>
  )
}

// ─── Compose Preview ──────────────────────────────────────────────────────────
// Renders body + selected signature exactly as the recipient will see it.
// {{name}} is shown literally here — actual substitution happens server-side
// per recipient.

function ComposePreview({
  subject,
  body,
  signatureId,
  signatures,
  letterhead,
  sampleLead,
}: {
  subject: string
  body: string
  signatureId: string
  signatures: { id: number; title: string; content?: string }[]
  letterhead: string
  sampleLead: { name: string; email: string | null } | null
}) {
  const [open, setOpen] = useState(true)
  const currentUser = useAuthStore((s) => s.user)
  const sig = signatures.find((s) => String(s.id) === signatureId)
  const sigHtml = sig?.content ?? ''

  // Mirror the server-side personalize() exactly, so what the preview shows is
  // what the recipient actually receives. Recipient tokens come from the
  // sample lead; counsellor tokens come from the signed-in user.
  const name = (sampleLead?.name || '').trim() || 'there'
  const firstName = name.split(/\s+/)[0]
  const counsellorName = (currentUser?.name || '').trim()
  const subs: Record<string, string> = {
    name,
    firstName,
    email: sampleLead?.email || '',
    counsellorName,
    counsellorFirstName: counsellorName ? counsellorName.split(/\s+/)[0] : '',
    counsellorEmail: currentUser?.email || '',
  }
  const substitute = (html: string) => html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => subs[k] ?? '')

  return (
    <div className="border rounded-lg bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold hover:bg-muted/40 rounded-t-lg"
      >
        <span>
          Preview
          {sampleLead ? ` · as sent to ${sampleLead.name || sampleLead.email}` : ' · pick a recipient to auto-fill names'}
          {sig ? ` · signature: ${sig.title}` : ' · no signature'}
        </span>
        <span className="text-muted-foreground">{open ? 'Hide ▲' : 'Show ▼'}</span>
      </button>
      {open && (
        <div className="px-3 py-3 border-t bg-muted/10 space-y-2">
          <div className="text-xs text-muted-foreground px-1">
            <span className="font-semibold">Subject:</span> {subject ? substitute(subject) : <span className="italic">[empty]</span>}
          </div>
          {/* Render inside the shared iframe preview so the app's Tailwind
              typography can't leak in — the sent email doesn't have `.prose`
              styles, so a prose-styled preview lied about the real layout. */}
          <HtmlPreview
            html={body || '<p style="color:#9ca3af;font-style:italic;">[ body is empty ]</p>'}
            empty="Body is empty"
            subs={subs}
            height={380}
            wrap={(inner) => letterhead + inner + (sigHtml ? `<br/><br/>${sigHtml}` : '')}
          />
        </div>
      )}
    </div>
  )
}

function FullMailPreviewModal({
  subject, body, signatureId, signatures, letterhead, sampleLead, senderName, senderEmail, recipientCount, onClose, onContinue,
}: {
  subject: string; body: string; signatureId: string
  signatures: { id: number; title: string; content?: string }[]; letterhead: string
  sampleLead: { name: string; email: string | null } | null
  senderName: string; senderEmail: string; recipientCount: number
  onClose: () => void; onContinue: () => void
}) {
  const user = useAuthStore((s) => s.user)
  const signature = signatures.find((item) => String(item.id) === signatureId)?.content || ''
  const name = (sampleLead?.name || '').trim() || 'there'
  const counsellorName = (user?.name || '').trim()
  const subs: Record<string, string> = {
    name, firstName: name.split(/\s+/)[0], email: sampleLead?.email || '',
    counsellorName, counsellorFirstName: counsellorName ? counsellorName.split(/\s+/)[0] : '',
    counsellorEmail: user?.email || '',
  }
  const renderedSubject = subject.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => subs[key] ?? '')
  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-3 sm:p-6 flex items-center justify-center">
      <div className="w-full max-w-6xl h-full max-h-[900px] bg-background rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between gap-4">
          <div><h2 className="text-lg font-bold">Full email preview</h2><p className="text-sm text-muted-foreground">Review the complete message before choosing recipients.</p></div>
          <button type="button" onClick={onClose} className="p-2 rounded hover:bg-muted" aria-label="Close preview"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 bg-muted/30">
          <div className="max-w-4xl mx-auto bg-white border rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b text-sm space-y-1.5">
              <div><span className="inline-block w-16 text-muted-foreground">From</span><strong>{senderName}</strong> &lt;{senderEmail}&gt;</div>
              <div><span className="inline-block w-16 text-muted-foreground">To</span>{recipientCount.toLocaleString()} recipient{recipientCount === 1 ? '' : 's'}{sampleLead ? ' — previewing ' + (sampleLead.name || sampleLead.email) : ''}</div>
              <div><span className="inline-block w-16 text-muted-foreground">Subject</span><strong>{renderedSubject || '(no subject)'}</strong></div>
            </div>
            <HtmlPreview html={body} empty="Body is empty" subs={subs} height={560}
              wrap={(inner) => letterhead + inner + (signature ? '<br/><br/>' + signature : '')} />
          </div>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-2 bg-background">
          <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg hover:bg-muted">Cancel</button>
          <button type="button" onClick={onContinue} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-semibold flex items-center gap-2"><Users className="h-4 w-4" /> Confirm recipients</button>
        </div>
      </div>
    </div>
  )
}

function RecipientConfirmationModal({ leads, total, isFilter, pending, senderEmail, onBack, onClose, onConfirm }: {
  leads: { id: number; name: string; email: string | null }[]; total: number; isFilter: boolean; pending: boolean; senderEmail: string
  onBack: () => void; onClose: () => void; onConfirm: () => void
}) {
  const shown = leads.slice(0, 100)
  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-3 sm:p-6 flex items-center justify-center">
      <div className="w-full max-w-2xl max-h-[85vh] bg-background rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between"><div><h2 className="text-lg font-bold">Confirm recipients</h2><p className="text-sm text-muted-foreground">Sending from {senderEmail} to {total.toLocaleString()} lead{total === 1 ? '' : 's'}.</p></div><button type="button" onClick={onClose} className="p-2 rounded hover:bg-muted"><X className="h-5 w-5" /></button></div>
        <div className="flex-1 overflow-y-auto divide-y">
          {isFilter && <div className="p-4 text-xs bg-amber-50 text-amber-900 border-b">The names below are the first matches on this page. Sending uses all active leads matching your filters.</div>}
          {shown.map((lead) => <div key={lead.id} className="px-5 py-3 flex items-center gap-3"><span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">{lead.name.charAt(0).toUpperCase()}</span><div className="min-w-0"><div className="font-semibold text-sm">{lead.name}</div><div className="text-xs text-muted-foreground truncate">{lead.email || 'No email address'}</div></div></div>)}
          {total > shown.length && <div className="p-4 text-center text-sm text-muted-foreground">+ {(total - shown.length).toLocaleString()} more recipients</div>}
        </div>
        <div className="px-5 py-4 border-t flex justify-between gap-2"><button type="button" onClick={onBack} disabled={pending} className="px-4 py-2 border rounded-lg hover:bg-muted">Back to preview</button><button type="button" onClick={onConfirm} disabled={pending || total === 0} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-semibold flex items-center gap-2 disabled:opacity-50">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send to {total.toLocaleString()} lead{total === 1 ? '' : 's'}</button></div>
      </div>
    </div>
  )
}

// ─── Sent History Tab ─────────────────────────────────────────────────────────

function HistoryTab() {
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(50)
  const [preview, setPreview] = useState<SentMail | null>(null)
  // Status filter — matches the chips at the top of the list.
  const [filter, setFilter] = useState<'' | 'sent' | 'failed' | 'pending' | 'opened' | 'replied'>('')
  // Source filter — 'direct' = quick sends only, 'campaign' = campaign
  // recipients only, '' = both merged. Sent as `source` to the backend so the
  // paging counts stay accurate instead of the frontend having to hide half.
  const [sourceFilter, setSourceFilter] = useState<'' | 'direct' | 'campaign'>('')
  // Search input + a debounced echo. The debounce keeps the query from firing
  // on every keystroke — waits 300 ms after typing stops, same as Leads search.
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])
  useEffect(() => { setPage(1) }, [search, sourceFilter, limit])

  const { data, isLoading } = useQuery<{
    data: SentMail[]
    total: number
    totalPages: number
  }>({
    queryKey: ['comm', 'sent', { page, limit, search, sourceFilter }],
    queryFn: () => communicationApi.sent({
      page,
      limit,
      ...(search ? { search } : {}),
      ...(sourceFilter ? { source: sourceFilter } : {}),
    }),
  })

  const allMails = data?.data || []
  // Client-side status filter — the backend returns everything so the summary
  // pills above the list can show accurate counts across the whole page.
  const mails = useMemo(() => {
    return allMails.filter((m) => {
      if (sourceFilter && m.source !== sourceFilter) return false
      if (!filter) return true
      if (filter === 'opened') return !!m.openedAt
      if (filter === 'replied') return !!m.repliedAt
      return m.status === filter
    })
  }, [allMails, filter, sourceFilter])
  const summary = useMemo(() => ({
    sent: allMails.filter((m) => m.status === 'sent').length,
    failed: allMails.filter((m) => m.status === 'failed').length,
    pending: allMails.filter((m) => m.status === 'pending').length,
    opened: allMails.filter((m) => !!m.openedAt).length,
    replied: allMails.filter((m) => !!m.repliedAt).length,
    direct: allMails.filter((m) => m.source === 'direct').length,
    campaign: allMails.filter((m) => m.source === 'campaign').length,
  }), [allMails])

  const pillCls = (active: boolean) =>
    `px-2.5 py-1 text-[11px] rounded-full font-semibold border ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground hover:bg-accent'}`

  return (
    <>
      <div className="bg-card border rounded-xl">
        <div className="px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Execution Log · {(data?.total ?? 0).toLocaleString()} messages
          </span>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={async () => {
                try {
                  const blob = await communicationApi.sentExport({
                    ...(search ? { search } : {}),
                    ...(sourceFilter ? { source: sourceFilter } : {}),
                  })
                  const stamp = new Date().toISOString().slice(0, 10)
                  downloadBlob(blob, `mail-history-${stamp}.csv`)
                } catch {
                  toast.error('Export failed')
                }
              }}
              className="px-2.5 py-1 border rounded hover:bg-accent font-semibold text-muted-foreground hover:text-foreground"
              title="Download the current filter as a CSV"
            >
              Export CSV
            </button>
            <label className="text-muted-foreground">Per page</label>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="px-2 py-1 border rounded bg-background"
            >
              {[50, 100, 200, 500].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span className="text-muted-foreground">
              Page {page} of {data?.totalPages || 1}
            </span>
          </div>
        </div>

        {/* Server-side search — checks recipient email/name, quick-send
            subject, and campaign name/subject. Debounced 300 ms so paging
            doesn't refire on every keystroke. */}
        <div className="px-4 py-2 border-b bg-muted/5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by recipient email/name, subject, or campaign name…"
              className="w-full pl-9 pr-8 py-1.5 text-sm border rounded-lg bg-background"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted"
                title="Clear search"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        {/* Filter pills — show the full funnel for the current page */}
        <div className="px-4 py-2 border-b flex items-center gap-1.5 flex-wrap bg-muted/10">
          <button onClick={() => setFilter('')} className={pillCls(filter === '')}>All <span className="opacity-70 ml-1">({allMails.length})</span></button>
          <button onClick={() => setFilter('sent')} className={pillCls(filter === 'sent')}>Sent <span className="opacity-70 ml-1">({summary.sent})</span></button>
          <button onClick={() => setFilter('opened')} className={pillCls(filter === 'opened')}>Opened <span className="opacity-70 ml-1">({summary.opened})</span></button>
          <button onClick={() => setFilter('replied')} className={pillCls(filter === 'replied')}>Replied <span className="opacity-70 ml-1">({summary.replied})</span></button>
          <button onClick={() => setFilter('failed')} className={pillCls(filter === 'failed')}>Failed <span className="opacity-70 ml-1">({summary.failed})</span></button>
          {summary.pending > 0 && (
            <button onClick={() => setFilter('pending')} className={pillCls(filter === 'pending')}>Pending <span className="opacity-70 ml-1">({summary.pending})</span></button>
          )}
        </div>

        {/* Source filter — 'direct' = quick sends from Compose, 'campaign' =
            scheduled campaign recipients. Kept as its own row so it composes
            with the status filter above ("show me only campaign FAILURES"). */}
        <div className="px-4 py-2 border-b flex items-center gap-1.5 flex-wrap bg-muted/10 text-[11px]">
          <span className="text-muted-foreground uppercase tracking-wider font-semibold mr-1">Source</span>
          <button onClick={() => setSourceFilter('')} className={pillCls(sourceFilter === '')}>Any <span className="opacity-70 ml-1">({allMails.length})</span></button>
          <button onClick={() => setSourceFilter('direct')} className={pillCls(sourceFilter === 'direct')}>Direct <span className="opacity-70 ml-1">({summary.direct})</span></button>
          <button onClick={() => setSourceFilter('campaign')} className={pillCls(sourceFilter === 'campaign')}>Campaign <span className="opacity-70 ml-1">({summary.campaign})</span></button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : mails.length === 0 ? (
          <p className="text-center py-10 text-sm text-muted-foreground">
            {filter ? `No ${filter} mails on this page.` : 'No emails sent yet.'}
          </p>
        ) : (
          <div className="divide-y">
            {mails.map((m) => {
              // One status colour picks the dominant state — replied wins
              // because it's the strongest positive signal, then opened, then
              // sent/failed. Keeps the little dot honest.
              const dotColor =
                m.repliedAt ? 'bg-violet-500' :
                m.openedAt ? 'bg-sky-500' :
                m.status === 'sent' ? 'bg-emerald-500' :
                m.status === 'failed' ? 'bg-rose-500' :
                'bg-amber-500'
              return (
                <button
                  key={m.id}
                  onClick={() => setPreview(m)}
                  className="w-full text-left px-4 py-3 hover:bg-accent/30 flex items-center gap-3"
                >
                  <div className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} title={m.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Source badge — first thing on the row so admins can
                          scan "was this a personal quick send or part of a
                          campaign blast?" at a glance. Campaign chip also
                          names the campaign so it doubles as a jump-off. */}
                      {m.source === 'campaign' ? (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-semibold"
                          title={m.campaignName ? `Campaign: ${m.campaignName}` : 'Sent as part of a campaign'}
                        >
                          CAMPAIGN{m.campaignName ? ` · ${m.campaignName.slice(0, 30)}${m.campaignName.length > 30 ? '…' : ''}` : ''}
                        </span>
                      ) : (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold"
                          title="Sent directly from the Compose tab (quick send)"
                        >
                          DIRECT
                        </span>
                      )}
                      <span className="font-semibold text-sm truncate">{m.subject}</span>
                      {m.leadId && <LeadLinkChip id={m.leadId} />}
                      {/* Status chips — replied / opened / failed / pending.
                          "sent" alone is the default state so we skip that
                          chip to reduce visual noise. */}
                      {m.repliedAt && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-semibold">replied</span>}
                      {m.openedAt && !m.repliedAt && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-semibold">opened</span>}
                      {m.status === 'failed' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-semibold">failed</span>}
                      {m.status === 'pending' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">pending</span>}
                      {m.group && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">via {m.group.fromEmail}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <span>To: {m.toEmail}</span>
                      <CopyButton text={m.toEmail} title="Copy recipient email" />
                      <span>· by {m.user?.name || '—'}</span>
                      {m.errorMessage && <span className="text-rose-600 ml-1">· {m.errorMessage.slice(0, 60)}</span>}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0 text-right">
                    <div className="font-medium text-foreground">Sent {formatDateTime(m.createdAt)}</div>
                    {m.openedAt && <div className="text-sky-700">opened {formatDateTime(m.openedAt)}</div>}
                    {m.repliedAt && <div className="text-violet-700">replied {formatDateTime(m.repliedAt)}</div>}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {(data?.totalPages || 1) > 1 && (
          <div className="px-4 py-2 border-t flex items-center justify-end gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-accent"
            >
              Prev
            </button>
            <button
              disabled={page >= (data?.totalPages || 1)}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-accent"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-card border rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
          >
            <div className="px-5 py-4 border-b bg-muted/30 flex items-center justify-between">
              <div>
                <h3 className="font-bold">{preview.subject}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  To: {preview.toEmail} · Sent {formatDateTime(preview.createdAt)} · by{' '}
                  {preview.user?.name || '—'}
                </p>
              </div>
              <button
                onClick={() => setPreview(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
            <div
              className="overflow-y-auto p-5 prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: preview.body }}
            />
          </div>
        </div>
      )}
    </>
  )
}

// ─── Inbox Tab ────────────────────────────────────────────────────────────────
// Reads from `/api/inbox`, populated by the per-CampaignGroup IMAP poller.
// Configure each sender at /app/campaign-groups (host/port/user/pass for IMAP)
// — the poller picks up replies within 60s and links them to the campaign
// recipient + lead automatically.

interface InboundMail {
  id: number
  fromEmail: string
  fromName: string | null
  toEmail: string
  subject: string
  bodyHtml: string | null
  bodyText: string | null
  receivedAt: string
  isRead: boolean
  group: { id: number; name: string; fromEmail: string } | null
  lead: { id: number; name: string } | null
  recipient: { id: number; campaignId: number; campaign: { id: number; name: string; subject: string } } | null
}

function InboxTab() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)
  // Which email account inbox to show — empty = every account.
  const [groupId, setGroupId] = useState('')

  const { data: accounts = [] } = useQuery<{ id: number; name: string; fromEmail: string; isActive: boolean }[]>({
    queryKey: ['campaigns', 'groups'],
    queryFn: campaignsApi.groups,
  })

  const { data, isLoading, isFetching } = useQuery<{
    data: InboundMail[]
    total: number
    page: number
    totalPages: number
  }>({
    queryKey: ['inbox', 'list', { page, unreadOnly, groupId }],
    queryFn: () => inboxApi.list({ page, limit: 50, unreadOnly: unreadOnly ? 1 : 0, groupId: groupId ? Number(groupId) : undefined }),
    refetchInterval: 30_000,
  })

  // Deterministic-per-account tint for the little chip. Keeps the same account
  // the same colour every render so the eye can pattern-match quickly.
  const chipTintForGroup = (id: number | null | undefined) => {
    if (!id) return 'bg-slate-100 text-slate-700 border-slate-200'
    const tints = [
      'bg-sky-100 text-sky-700 border-sky-200',
      'bg-emerald-100 text-emerald-700 border-emerald-200',
      'bg-violet-100 text-violet-700 border-violet-200',
      'bg-amber-100 text-amber-700 border-amber-200',
      'bg-rose-100 text-rose-700 border-rose-200',
      'bg-indigo-100 text-indigo-700 border-indigo-200',
    ]
    return tints[Number(id) % tints.length]
  }

  const detail = useQuery<InboundMail>({
    queryKey: ['inbox', 'detail', openId],
    queryFn: () => inboxApi.get(openId as number),
    enabled: openId != null,
  })

  const removeMail = useMutation({
    mutationFn: (id: number) => inboxApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbox'] })
      setOpenId(null)
      toast.success('Deleted')
    },
    onError: () => toast.error('Delete failed'),
  })

  const mails = data?.data ?? []

  // New-inbound toast — compare the top id across refetch ticks. First fetch
  // just captures the baseline (no toast). Subsequent fetches toast whenever
  // the top id changes — captures replies landing while the admin is on the
  // page. Guarded by page === 1 + not-filtered-by-groupId so pagination
  // doesn't trigger a spurious "new mail" alert.
  const topIdRef = useMemo(() => ({ id: null as number | null, primed: false }), [])
  useEffect(() => {
    if (!mails.length) return
    const top = mails[0].id
    if (!topIdRef.primed) {
      topIdRef.id = top
      topIdRef.primed = true
      return
    }
    if (top !== topIdRef.id && page === 1) {
      const from = mails[0].fromName || mails[0].fromEmail
      toast.success(`New reply from ${from}`, {
        description: mails[0].subject?.slice(0, 80),
      })
      topIdRef.id = top
    }
  }, [mails, page, topIdRef])

  return (
    <div className="space-y-3">
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="px-4 py-2 border-b flex items-center gap-3 bg-muted/30 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Inbox · {data?.total ?? 0} mails
          </span>
          {/* Account filter — the "which mail account did this come to?" question,
              which was implicit before (all inboxes merged). Empty value shows
              everything, and each account keeps a stable colour chip on the row
              so a merged view still reads as "these came into support, those
              into admissions". */}
          <select
            value={groupId}
            onChange={(e) => { setGroupId(e.target.value); setPage(1) }}
            className="text-xs px-2 py-1 border rounded bg-background"
            title="Filter inbox by which email account received the message"
          >
            <option value="">All accounts{accounts.length ? ` (${accounts.length})` : ''}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.fromEmail}{a.isActive ? '' : ' (disabled)'}</option>
            ))}
          </select>
          <label className="text-xs flex items-center gap-1 ml-2">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1) }} className="rounded" />
            Unread only
          </label>
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ['inbox'] })}
            disabled={isFetching}
            className="ml-auto p-1 rounded hover:bg-muted disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : mails.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">
            No replies yet. Configure IMAP on an account under <strong>Email Accounts</strong> — the poller will start picking up replies within 60s.
          </div>
        ) : (
          <ul className="divide-y max-h-[60vh] overflow-y-auto">
            {mails.map((m) => (
              <li
                key={m.id}
                className={`flex items-center gap-3 px-4 py-2.5 hover:bg-accent/30 cursor-pointer ${!m.isRead ? 'bg-blue-50/40' : ''}`}
                onClick={() => setOpenId(m.id)}
              >
                {m.isRead ? <MailOpen className="h-4 w-4 text-muted-foreground" /> : <MailUnreadIcon className="h-4 w-4 text-primary" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm truncate ${!m.isRead ? 'font-bold' : 'font-medium'}`}>
                      {m.fromName || m.fromEmail}
                    </span>
                    <CopyButton text={m.fromEmail} title="Copy sender email" />
                    {/* Which mailbox received this message — chip colour is
                        stable per account so the eye can pattern-match "these
                        are support@…, those are admissions@…" at a glance. */}
                    {m.group && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${chipTintForGroup(m.group.id)}`}
                        title={`Received by ${m.group.fromEmail}`}
                      >
                        {m.group.fromEmail}
                      </span>
                    )}
                    {m.recipient?.campaign && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-semibold">
                        reply · {m.recipient.campaign.name}
                      </span>
                    )}
                    {m.lead && (
                      <Link
                        to="/app/leads/$leadId"
                        params={{ leadId: String(m.lead.id) }}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold hover:underline"
                        title={`Open lead #${m.lead.id} in a new tab`}
                      >
                        lead: {m.lead.name}
                      </Link>
                    )}
                  </div>
                  <div className={`text-sm truncate ${!m.isRead ? 'font-semibold' : ''}`}>{m.subject}</div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">{formatDateTime(m.receivedAt)}</div>
              </li>
            ))}
          </ul>
        )}

        {(data?.totalPages || 1) > 1 && (
          <div className="px-4 py-2 border-t flex items-center justify-end gap-2 text-xs">
            <span className="text-muted-foreground">Page {data?.page} of {data?.totalPages}</span>
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-2 py-1 border rounded disabled:opacity-40">Prev</button>
            <button disabled={page >= (data?.totalPages || 1)} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 border rounded disabled:opacity-40">Next</button>
          </div>
        )}
      </div>

      {openId != null && (
        <InboxReader
          id={openId}
          detail={detail.data ?? null}
          isLoading={detail.isLoading}
          onClose={() => setOpenId(null)}
          onDelete={() => { if (confirm('Delete this reply?')) removeMail.mutate(openId) }}
        />
      )}
    </div>
  )
}

// ─── Inbox Reader ─────────────────────────────────────────────────────────────
// Mail-client style reading pane: sender header, subject, iframe-rendered body
// (so recipient HTML doesn't leak Tailwind styles or execute scripts), and an
// inline Reply composer that expands beneath. Replying threads via In-Reply-To
// on the backend, so the sender's mail client keeps the conversation grouped.

function InboxReader({
  id,
  detail,
  isLoading,
  onClose,
  onDelete,
}: {
  id: number
  detail: InboundMail | null
  isLoading: boolean
  onClose: () => void
  onDelete: () => void
}) {
  const qc = useQueryClient()
  const [replying, setReplying] = useState(false)
  const [replySubject, setReplySubject] = useState('')
  const [replyBody, setReplyBody] = useState('')

  const { data: signatures = [] } = useQuery<{ id: number; title: string; content?: string; isDefault?: boolean }[]>({
    queryKey: ['comm', 'signatures'],
    queryFn: communicationApi.signatures,
  })
  const defaultSig = signatures.find((s) => s.isDefault) ?? signatures[0]

  // Prefill the reply subject with the standard "Re: …" once the detail loads.
  // Keeping this in an effect (via useMemo side-effect trick used elsewhere in
  // the file) means it resets each time the reader opens a new mail id.
  useMemo(() => {
    if (detail && !replySubject) {
      const already = /^re:\s*/i.test(detail.subject)
      setReplySubject(already ? detail.subject : `Re: ${detail.subject}`)
    }
    // Reset the composer whenever the opened mail changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const sendReply = useMutation({
    mutationFn: () => inboxApi.reply(id, {
      subject: replySubject,
      body: replyBody,
      signatureId: defaultSig?.id ?? undefined,
    }),
    onSuccess: () => {
      toast.success('Reply sent')
      setReplying(false)
      setReplyBody('')
      qc.invalidateQueries({ queryKey: ['comm', 'sent'] })
      qc.invalidateQueries({ queryKey: ['comm', 'mail-reports-summary'] })
    },
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || 'Reply failed')
    },
  })

  // Initials for the sender avatar — cheap "who's this from?" cue without any
  // asset fetching, matching what Gmail / Outlook do when there's no photo.
  const initials = useMemo(() => {
    const source = (detail?.fromName || detail?.fromEmail || '').trim()
    if (!source) return '?'
    const parts = source.split(/\s+|@/).filter(Boolean)
    return (parts[0]?.[0] || '?').toUpperCase() + (parts[1]?.[0] || '').toUpperCase()
  }, [detail])

  const bodyForIframe = detail?.bodyHtml || (detail?.bodyText
    ? `<pre style="white-space:pre-wrap;font-family:inherit;margin:0;">${escapeHtmlInline(detail.bodyText)}</pre>`
    : '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-card border rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* ── Toolbar ── */}
        <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2">
          <button
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:bg-muted rounded flex items-center gap-1 text-xs font-semibold"
            title="Back to inbox"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setReplying((r) => !r)}
              className={`px-3 py-1.5 rounded font-semibold text-xs flex items-center gap-1.5 ${
                replying ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
              disabled={!detail}
              title="Reply — sends from the account that received this mail, threaded properly."
            >
              <ReplyIcon className="h-3.5 w-3.5" />
              {replying ? 'Cancel reply' : 'Reply'}
            </button>
            <button onClick={onDelete} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded" title="Delete">
              <Trash2 className="h-4 w-4" />
            </button>
            <button onClick={onClose} className="p-1.5 text-muted-foreground hover:bg-muted rounded" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Content ── */}
        <div className="overflow-y-auto flex-1">
          {isLoading || !detail ? (
            <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              {/* Subject line */}
              <div className="px-6 pt-5 pb-3">
                <h2 className="text-xl font-bold leading-tight">{detail.subject || '(no subject)'}</h2>
                {detail.recipient?.campaign && (
                  <p className="text-xs text-violet-700 mt-1">
                    ↳ Reply to campaign: <span className="font-semibold">{detail.recipient.campaign.name}</span>
                  </p>
                )}
                {detail.lead && (
                  <p className="text-xs text-emerald-700 mt-1">
                    Linked to lead: <span className="font-semibold">{detail.lead.name}</span>
                  </p>
                )}
              </div>

              {/* Sender block — avatar + from/to/received timestamp, styled like
                  Gmail's collapsed header. Full email addresses stay visible so
                  admins can spot spoofs at a glance. */}
              <div className="px-6 pb-3 flex items-start gap-3 border-b">
                <div className="h-10 w-10 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center shrink-0">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    <span className="font-semibold">{detail.fromName || detail.fromEmail}</span>
                    {detail.fromName && (
                      <span className="text-muted-foreground ml-1">&lt;{detail.fromEmail}&gt;</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    to {detail.toEmail}
                    {detail.group && <span> · via {detail.group.fromEmail}</span>}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                  {formatDateTime(detail.receivedAt)}
                </div>
              </div>

              {/* Body — rendered in a sandboxed iframe (same helper the compose
                  preview uses) so recipient CSS can't leak into the app and any
                  <script> in the mail is inert. Height sized generous so most
                  replies fit without an inner scrollbar. */}
              <div className="px-6 py-4">
                {bodyForIframe ? (
                  <HtmlPreview html={bodyForIframe} empty="No content" height={420} />
                ) : (
                  <p className="text-sm text-muted-foreground italic">No content.</p>
                )}
              </div>

              {/* Reply composer — appears below the body when the admin hits
                  Reply. Subject is prefilled, the send call threads via
                  In-Reply-To on the backend and shows up in Sent History + the
                  Reports funnel automatically. */}
              {replying && (
                <div className="border-t bg-muted/20 px-6 py-4 space-y-3">
                  <div className="text-xs text-muted-foreground">
                    Replying as <strong>{detail.group?.fromEmail ?? 'default account'}</strong>
                    {' '}to <strong>{detail.fromEmail}</strong>
                    {defaultSig && <span> · signature: {defaultSig.title}</span>}
                  </div>
                  <input
                    value={replySubject}
                    onChange={(e) => setReplySubject(e.target.value)}
                    className="w-full px-3 py-2 text-sm border rounded-lg bg-background font-semibold"
                    placeholder="Subject"
                  />
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    rows={10}
                    placeholder="Write your reply… (plain text or HTML)"
                    className="w-full px-3 py-2 text-sm border rounded-lg bg-background resize-y font-mono"
                    autoFocus
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => { setReplying(false); setReplyBody('') }}
                      className="px-3 py-1.5 text-sm border rounded"
                      disabled={sendReply.isPending}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => sendReply.mutate()}
                      disabled={!replySubject.trim() || !replyBody.trim() || sendReply.isPending}
                      className="px-4 py-1.5 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded font-semibold flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {sendReply.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Send reply
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Minimal HTML escaper for the plain-text-only branch of the reader — we wrap
// bodyText in a <pre> and hand it to the iframe, and this stops a raw '<' in
// the text from being parsed as markup.
function escapeHtmlInline(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))
}

// ─── Schedule Campaign Modal ──────────────────────────────────────────────────
// The admin picks: name → from account(s) → mails/hour (max 70) → start at.
// The per-mail gap is NOT an input — it's auto-derived (3600 / mailsPerHour,
// floored, min 30 s) and re-clamped server-side, so there's no way to get
// "70/hr with 5 s between", which is a fast route to a blocked mailbox. Live
// preview breaks the recipient list into hour × account buckets so admins see
// which lead goes out in which hour from which mailbox before committing.

interface ChunkPreviewItem {
  groupId: number
  groupName: string
  fromEmail: string
  recipientCount: number
  chunks: { index: number; scheduledAt: string; size: number }[]
  totalChunks?: number       // real total per group (may be > chunks.length)
  cap?: number               // per-hour cap this group ended up with
  chunksTruncated?: boolean
}
interface PreviewResponse {
  totalRecipients: number
  totalChunks: number
  perEmailDelayMs: number
  batchGapMs: number
  startAt: string
  lastChunkScheduledAt: string
  plan: ChunkPreviewItem[]
  chunksTruncated?: boolean
  chunkLimitPerGroup?: number
}

interface HourRow {
  groupId: number
  groupName: string
  fromEmail: string
  size: number
  from: number
  to: number
}
interface HourBucket {
  hour: number
  scheduledAt: string
  rows: HourRow[]
  total: number
}
interface AccountSummary {
  groupId: number
  groupName: string
  fromEmail: string
  recipientCount: number
  cap: number
  hours: number
  from: number
  to: number
}

interface ActiveGroup { id: number; name: string; fromName: string; fromEmail: string }

// Derived from mailsPerHour, capped at both ends:
//   - ≥ 30 s ("at least 30 seconds gap" from the brief)
//   - ≤ 3600 s (below 1/hr the modal shouldn't have let you here anyway)
function delaySecondsFor(mailsPerHour: number): number {
  const raw = Math.floor(3600 / Math.max(1, mailsPerHour))
  return Math.max(30, Math.min(3600, raw))
}

function ScheduleCampaignModal({
  subject,
  bodyHtml,
  signatureId,
  leadIds,
  activeGroups,
  defaultGroupId,
  onClose,
  onScheduled,
}: {
  subject: string
  bodyHtml: string
  signatureId: number | null
  leadIds: number[]
  activeGroups: ActiveGroup[]
  defaultGroupId: number | null
  onClose: () => void
  onScheduled: () => void
}) {
  const [name, setName] = useState(subject.slice(0, 60) || 'Untitled campaign')
  // Which email accounts this campaign fans out over. Multi-select — when the
  // admin picks more than one account the recipient list is auto-split EQUALLY
  // across them (`distribution: 'EQUAL'` on the backend). One account = the
  // old single-mailbox behaviour, backed by AUTHORITY so the plan matches
  // pre-multi-select campaigns.
  const [groupIds, setGroupIds] = useState<number[]>(
    defaultGroupId != null ? [defaultGroupId] : activeGroups[0] ? [activeGroups[0].id] : [],
  )
  const toggleGroup = (id: number) =>
    setGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]))
  // Hard cap at 70 (per brief). Default is 60 — comfortably under the cap and
  // works out to exactly 60 s between mails so the numbers are easy to reason
  // about.
  const [mailsPerHour, setMailsPerHour] = useState(60)
  // Debounced echo of mailsPerHour — the input can be edited freely without
  // firing a fresh /preview request on every keystroke (which used to error
  // out when an intermediate value like "1" briefly created a 59k-chunk plan
  // on the backend before the user finished typing "10").
  const [mailsPerHourDebounced, setMailsPerHourDebounced] = useState(60)
  useEffect(() => {
    const t = setTimeout(() => setMailsPerHourDebounced(mailsPerHour), 350)
    return () => clearTimeout(t)
  }, [mailsPerHour])

  // Per-account rate overrides. When multiple accounts are picked the admin
  // can give each mailbox its own hourly rate (e.g. A=60, B=30, C=70) so the
  // three domains send truly in parallel at independent paces instead of a
  // shared campaign-wide rate. Keyed by group id → mails/hour.
  const [perGroupCaps, setPerGroupCaps] = useState<Record<number, number>>({})
  const [perGroupCapsDebounced, setPerGroupCapsDebounced] = useState<Record<number, number>>({})
  useEffect(() => {
    const t = setTimeout(() => setPerGroupCapsDebounced(perGroupCaps), 350)
    return () => clearTimeout(t)
  }, [perGroupCaps])

  // Seed / prune the per-account rate map so it always mirrors the current
  // selection. Newly picked account → default to 60. Unpicked account → drop.
  useEffect(() => {
    setPerGroupCaps((prev) => {
      const next: Record<number, number> = {}
      for (const id of groupIds) next[id] = prev[id] ?? 60
      return next
    })
  }, [groupIds])

  const [startAt, setStartAt] = useState(() => {
    // Default: 1 minute from now — gives you a beat to review before it fires.
    const d = new Date(Date.now() + 60_000)
    return d.toISOString().slice(0, 16)
  })

  // Auto gap between two mails on the SAME mailbox — never shown as an input,
  // the admin only picks a rate and this follows. Derived from the FASTEST
  // account in the campaign: that mailbox is the one whose hour fills up
  // first, so pacing off it guarantees no chunk spills past its own hour into
  // the next one. (Pacing off the slowest account, as this used to, made a
  // 70/hr mailbox sit on a 6-minute gap and run 7 hours late.) The floor of
  // 30 s inside delaySecondsFor is what keeps an account from looking like a
  // blast and getting blocked.
  const derivedDelaySec = useMemo(() => {
    const rates = groupIds.length > 1
      ? groupIds.map((id) => perGroupCapsDebounced[id] ?? mailsPerHourDebounced)
      : [mailsPerHourDebounced]
    const fastest = rates.length > 0 ? Math.max(...rates) : mailsPerHourDebounced
    return delaySecondsFor(fastest)
  }, [groupIds, perGroupCapsDebounced, mailsPerHourDebounced])

  const previewBody = useMemo(() => {
    const usePerGroup = groupIds.length > 1 && Object.keys(perGroupCapsDebounced).length > 0
    return {
      leadIds,
      // Restrict distribution to the picked accounts. One account = AUTHORITY
      // (weighted, single-mailbox — same as before). More than one = EQUAL, so
      // the leads split evenly across every mailbox the admin picked. Both
      // modes skip the MANUAL sum-check that used to trip when leads without
      // emails were filtered out server-side.
      ...(groupIds.length > 0 ? { groupIds } : {}),
      distribution: (groupIds.length > 1 ? 'EQUAL' : 'AUTHORITY') as 'AUTHORITY' | 'EQUAL',
      perEmailDelayMs: derivedDelaySec * 1000,
      batchGapMs: 3_600_000, // exactly one hour — matches "mails per hour"
      // For single-account campaigns, pass the global rate as before. For
      // multi-account, send the per-group map so each mailbox uses its own
      // rate. mailsPerHour is still included as a safety fallback for any
      // account we somehow forgot to enumerate.
      mailsPerHour: mailsPerHourDebounced,
      ...(usePerGroup ? {
        perGroupCaps: groupIds.map((id) => ({
          groupId: id,
          mailsPerHour: perGroupCapsDebounced[id] ?? mailsPerHourDebounced,
        })),
      } : {}),
      startAt: new Date(startAt).toISOString(),
    }
  }, [leadIds, groupIds, mailsPerHourDebounced, perGroupCapsDebounced, derivedDelaySec, startAt])

  const { data: preview, isLoading: previewLoading, error: previewError } = useQuery<PreviewResponse>({
    queryKey: ['campaigns', 'preview', previewBody],
    queryFn: () => campaignsApi.preview(previewBody),
    enabled: leadIds.length > 0 && groupIds.length > 0,
    retry: false,
    // Keep the last successful plan on screen while the next one is loading —
    // otherwise the "error" flash from a stale in-flight request shows during
    // rapid typing in the mails-per-hour field.
    placeholderData: (prev) => prev,
  })

  const createM = useMutation({
    mutationFn: () => campaignsApi.create({
      ...previewBody,
      name,
      subject,
      bodyHtml,
      signatureId,
    }),
    onSuccess: onScheduled,
    onError: (e: unknown) => {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err?.response?.data?.error || 'Failed to schedule')
    },
  })

  // A 400 from the API can carry `error` as a string OR (before the server
  // fix, and still for anything that slips past it) as a structured object
  // like a ZodError `{ issues, name }`. Rendering that object straight into
  // JSX is what blanked the whole page with React error #31, so everything is
  // coerced to a string here before it ever reaches the DOM.
  const errMsg = useMemo(() => {
    if (!previewError) return null
    const raw = (previewError as unknown as { response?: { data?: { error?: unknown } }; message?: string })
    const e = raw?.response?.data?.error
    if (typeof e === 'string') return e
    if (e && typeof e === 'object') {
      const zod = e as { issues?: { path?: (string | number)[]; message?: string }[] }
      if (Array.isArray(zod.issues)) {
        return zod.issues.map((i) => `${(i.path ?? []).join('.') || 'field'}: ${i.message ?? 'invalid'}`).join('; ')
      }
      return JSON.stringify(e)
    }
    return raw?.message || 'Could not compute the plan'
  }, [previewError])

  // ── Hour-by-hour plan, per account ────────────────────────────────────────
  // Every mailbox starts at the same `startAt` and steps by exactly one hour,
  // so a chunk's `index` IS its hour number regardless of which account it
  // came from. Chunks that share an index therefore belong in the same hour
  // row group — that's what turns the plan into "Hour 1 → 60 from Tutelage +
  // 60 from Britannica + 60 from MyMBBS" instead of the old flat list that
  // numbered every chunk of every account as its own "Hour N" and so counted
  // three parallel hours as three sequential ones.
  //
  // Lead numbers are global and match how the backend actually slices: it
  // walks `plan` in order and hands account #1 leads 1..n1, account #2 the
  // next n2, and so on, chunking each account's slice in order.
  const { hourlyPlan, perAccount, totalHours } = useMemo(() => {
    if (!preview) return { hourlyPlan: [] as HourBucket[], perAccount: [] as AccountSummary[], totalHours: 0 }
    const byHour = new Map<number, HourBucket>()
    const accounts: AccountSummary[] = []
    let offset = 0
    for (const p of preview.plan) {
      accounts.push({
        groupId: p.groupId,
        groupName: p.groupName,
        fromEmail: p.fromEmail,
        recipientCount: p.recipientCount,
        cap: p.cap ?? 0,
        hours: p.totalChunks ?? p.chunks.length,
        from: offset + 1,
        to: offset + p.recipientCount,
      })
      let within = 0
      for (const ch of p.chunks) {
        const from = offset + within + 1
        const to = offset + within + ch.size
        within += ch.size
        let bucket = byHour.get(ch.index)
        if (!bucket) {
          bucket = { hour: ch.index + 1, scheduledAt: ch.scheduledAt, rows: [], total: 0 }
          byHour.set(ch.index, bucket)
        }
        bucket.rows.push({ groupId: p.groupId, groupName: p.groupName, fromEmail: p.fromEmail, size: ch.size, from, to })
        bucket.total += ch.size
      }
      offset += p.recipientCount
    }
    // The campaign runs for as long as its BUSIEST mailbox — the accounts send
    // in parallel, so hours don't add up across them.
    const hours = preview.plan.reduce((m, p) => Math.max(m, p.totalChunks ?? p.chunks.length), 0)
    return {
      hourlyPlan: [...byHour.values()].sort((a, b) => a.hour - b.hour),
      perAccount: accounts,
      totalHours: hours,
    }
  }, [preview])

  // The server re-derives the gap (clamped to >=30 s and to whatever fits an
  // hour) and echoes it back, so once a plan is loaded prefer its number over
  // the local estimate — what the admin reads is then exactly what sends.
  const gapSec = preview ? Math.round(preview.perEmailDelayMs / 1000) : derivedDelaySec

  const selectedGroups = activeGroups.filter((g) => groupIds.includes(g.id))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-card border rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b bg-muted/30 flex items-center justify-between">
          <div>
            <h3 className="font-bold flex items-center gap-2"><Rocket className="h-4 w-4" /> Schedule campaign</h3>
            <p className="text-xs text-muted-foreground">Drips mails from one or more accounts at a controlled hourly rate. Every lead lands in a specific hour on a specific account — see the plan below.</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {activeGroups.length === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900">
              You have no active email accounts. Add one under <strong>Email Accounts</strong> before scheduling a campaign.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block col-span-2">
              <span className="text-xs text-muted-foreground">Campaign name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full mt-1 px-2 py-1.5 text-sm border rounded bg-background" placeholder="e.g. September catalog blast" />
            </label>

            <div className="col-span-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  From accounts (pick one or more — leads auto-split equally)
                </span>
                {activeGroups.length > 1 && (
                  <div className="flex gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setGroupIds(activeGroups.map((g) => g.id))}
                      className="text-primary font-semibold hover:underline"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setGroupIds([])}
                      className="text-muted-foreground hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-1 border rounded bg-background max-h-40 overflow-y-auto divide-y">
                {activeGroups.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No active accounts.</div>
                ) : (
                  activeGroups.map((g) => {
                    const checked = groupIds.includes(g.id)
                    return (
                      <label
                        key={g.id}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/40 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleGroup(g.id)}
                          className="rounded"
                        />
                        <span className="font-medium">{g.name}</span>
                        <span className="text-xs text-muted-foreground truncate">{g.fromEmail}</span>
                      </label>
                    )
                  })
                )}
              </div>
              {selectedGroups.length === 1 && (
                <span className="text-[11px] text-muted-foreground mt-1 inline-block">
                  Recipients will see: <strong>&quot;{selectedGroups[0].fromName}&quot; &lt;{selectedGroups[0].fromEmail}&gt;</strong>
                </span>
              )}
              {selectedGroups.length > 1 && (
                <span className="text-[11px] text-violet-700 mt-1 inline-block">
                  {leadIds.length.toLocaleString()} leads will be auto-divided equally across {selectedGroups.length} accounts
                  {' '}(~{Math.ceil(leadIds.length / selectedGroups.length).toLocaleString()} each).
                </span>
              )}
            </div>

            {/* Rate control — one input for a single account, per-account inputs
                for multi-account campaigns. Each mailbox's rate is independent,
                so admins can drip account A at 60/hr while account B goes at
                30/hr, all in true parallel (both start at the same startAt). */}
            {selectedGroups.length <= 1 ? (
              <label className="block col-span-2">
                <span className="text-xs text-muted-foreground">Mails per hour (max 70)</span>
                <input
                  type="number"
                  min={1}
                  max={70}
                  value={mailsPerHour}
                  // Only update state when the input parses to a real number in
                  // range. This lets the user backspace + retype freely without
                  // the field snapping to "1" mid-edit and firing a bogus preview
                  // for every intermediate value. Empty / invalid keeps the last
                  // valid mailsPerHour so the plan preview stays stable.
                  onChange={(e) => {
                    const raw = e.target.value
                    if (raw === '') return
                    const n = Math.floor(Number(raw))
                    if (!Number.isFinite(n) || n <= 0) return
                    setMailsPerHour(Math.min(70, n))
                  }}
                  // Clamp on blur so we never end up above 70 (e.g. "700" typed
                  // fast would set to 70 twice mid-way, but blurring guarantees
                  // the field agrees with state).
                  onBlur={(e) => {
                    const n = Math.floor(Number(e.target.value))
                    if (!Number.isFinite(n) || n < 1) setMailsPerHour(1)
                    else if (n > 70) setMailsPerHour(70)
                  }}
                  className="w-full mt-1 px-2 py-1.5 text-sm border rounded bg-background"
                />
                <span className="text-[11px] text-muted-foreground">
                  Hard cap 70/hr — protects sender reputation. Mails are spaced out automatically
                  ({gapSec}s apart, jittered) so the mailbox never looks like a blast.
                </span>
              </label>
            ) : (
              <div className="block col-span-2">
                <span className="text-xs text-muted-foreground">Mails per hour · per account (max 70 each)</span>
                <div className="mt-1 border rounded bg-background divide-y">
                  {selectedGroups.map((g) => (
                    <div key={g.id} className="flex items-center gap-3 px-3 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{g.name}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{g.fromEmail}</div>
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={70}
                        value={perGroupCaps[g.id] ?? 60}
                        onChange={(e) => {
                          const raw = e.target.value
                          if (raw === '') return
                          const n = Math.floor(Number(raw))
                          if (!Number.isFinite(n) || n <= 0) return
                          setPerGroupCaps((prev) => ({ ...prev, [g.id]: Math.min(70, n) }))
                        }}
                        onBlur={(e) => {
                          const n = Math.floor(Number(e.target.value))
                          const clamped = !Number.isFinite(n) || n < 1 ? 1 : Math.min(70, n)
                          setPerGroupCaps((prev) => ({ ...prev, [g.id]: clamped }))
                        }}
                        className="w-20 px-2 py-1 text-sm border rounded bg-background text-right"
                      />
                      <span className="text-[10px] text-muted-foreground w-8">/hr</span>
                    </div>
                  ))}
                </div>
                <span className="text-[11px] text-muted-foreground mt-1 inline-block">
                  Each mailbox runs at its own rate — all start together (parallel), none waits for another.
                  Hard cap 70/hr per account. Mails inside an hour are spaced out automatically
                  ({gapSec}s apart, jittered) so no account gets blocked.
                </span>
              </div>
            )}

            <label className="block col-span-2">
              <span className="text-xs text-muted-foreground">Start at</span>
              <div className="mt-1 flex gap-2">
                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  className="flex-1 px-2 py-1.5 text-sm border rounded bg-background"
                />
                {/* "Start now" — jumps startAt to the current moment so the
                    first chunk fires the moment the admin clicks Schedule.
                    Datetime-local expects a naive local ISO (no Z), which is
                    how the input renders too. */}
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
                    setStartAt(now.toISOString().slice(0, 16))
                  }}
                  className="px-3 py-1.5 text-xs font-semibold border rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200"
                  title="Set start time to right now — engine fires the first chunk within 30 s"
                >
                  Start now
                </button>
              </div>
              <span className="text-[11px] text-muted-foreground mt-1 inline-block">
                Scheduler tick runs every 30 s — with &quot;Start now&quot; the first mail goes out within about half a minute.
              </span>
            </label>
          </div>

          {previewLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Computing plan…</div>
          )}
          {errMsg && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded p-3">{errMsg}</div>
          )}

          {preview && hourlyPlan.length > 0 && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <Stat label="Recipients" value={preview.totalRecipients.toLocaleString()} />
                {/* Hours = the busiest mailbox's run length. Accounts send in
                    parallel, so this is a max, never a sum. */}
                <Stat label="Hours" value={totalHours.toLocaleString()} />
                <Stat label="Accounts" value={perAccount.length.toString()} />
                <Stat label="Finishes" value={preview.lastChunkScheduledAt ? new Date(preview.lastChunkScheduledAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'} />
              </div>

              {/* Who sends how much, before the hour-by-hour detail. */}
              {perAccount.length > 1 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="px-3 py-2 border-b bg-muted/30 text-xs font-semibold text-muted-foreground">
                    Split per account · all send in parallel
                  </div>
                  <div className="divide-y">
                    {perAccount.map((a) => (
                      <div key={a.groupId} className="flex items-center gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{a.groupName}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{a.fromEmail}</div>
                        </div>
                        <div className="text-right whitespace-nowrap">
                          <div className="text-sm font-semibold text-violet-700">{a.recipientCount.toLocaleString()} mails</div>
                          <div className="text-[11px] text-muted-foreground">
                            {a.cap}/hr · {a.hours.toLocaleString()} h · leads {a.from.toLocaleString()}–{a.to.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Hour-by-hour, split by account: every lead in the campaign
                  lives on exactly one row here, so nothing goes missing
                  before scheduling. */}
              <div className="border rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b bg-muted/30 text-xs font-semibold text-muted-foreground flex items-center justify-between">
                  <span>Hourly breakdown · per account</span>
                  <span className="text-[10px] normal-case font-normal">
                    {totalHours.toLocaleString()} hour{totalHours === 1 ? '' : 's'} · {perAccount.length} account{perAccount.length === 1 ? '' : 's'} sending together
                  </span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {/* Render at most 200 hours — a slow rate + large audience
                      (e.g. 60k leads at 5/hr) used to freeze the browser while
                      laying out that many rows. */}
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/30">
                      <tr className="text-left text-xs text-muted-foreground border-b">
                        <th className="px-3 py-1.5 font-medium">Hour</th>
                        <th className="px-3 py-1.5 font-medium">Window</th>
                        <th className="px-3 py-1.5 font-medium">From account</th>
                        <th className="px-3 py-1.5 font-medium text-right">Mails</th>
                        <th className="px-3 py-1.5 font-medium">Recipient range</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hourlyPlan.slice(0, 200).map((h) => {
                        const t = new Date(h.scheduledAt)
                        const endT = new Date(t.getTime() + 3_600_000)
                        const hhmm = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        return h.rows.map((r, ri) => (
                          <tr key={`${h.hour}-${r.groupId}`} className="border-b hover:bg-muted/20">
                            {ri === 0 && (
                              <>
                                <td rowSpan={h.rows.length} className="px-3 py-1.5 font-semibold align-top border-r">
                                  Hour {h.hour}
                                  <div className="text-[10px] font-normal text-muted-foreground">{h.total} mails</div>
                                </td>
                                <td rowSpan={h.rows.length} className="px-3 py-1.5 text-xs text-muted-foreground whitespace-nowrap align-top border-r">
                                  {t.toLocaleDateString([], { day: '2-digit', month: 'short' })}
                                  <div>{hhmm(t)}–{hhmm(endT)}</div>
                                </td>
                              </>
                            )}
                            <td className="px-3 py-1.5 text-xs">
                              <div className="font-medium">{r.groupName}</div>
                              <div className="text-muted-foreground">{r.fromEmail}</div>
                            </td>
                            <td className="px-3 py-1.5 text-right font-semibold text-violet-700">{r.size}</td>
                            <td className="px-3 py-1.5 text-xs text-muted-foreground whitespace-nowrap">
                              Leads {r.from.toLocaleString()}–{r.to.toLocaleString()}
                            </td>
                          </tr>
                        ))
                      })}
                    </tbody>
                    <tfoot className="bg-muted/20">
                      {totalHours > Math.min(hourlyPlan.length, 200) && (
                        <tr className="text-xs">
                          <td colSpan={5} className="px-3 py-2 text-center text-muted-foreground italic">
                            + {(totalHours - Math.min(hourlyPlan.length, 200)).toLocaleString()} more hours not shown
                            (plan runs {totalHours.toLocaleString()} hours in total)
                          </td>
                        </tr>
                      )}
                      <tr className="text-xs">
                        <td colSpan={3} className="px-3 py-2 font-semibold text-right">Total</td>
                        <td className="px-3 py-2 text-right font-bold">{preview.totalRecipients.toLocaleString()}</td>
                        <td className="px-3 py-2 text-muted-foreground">every lead scheduled</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t bg-muted/20 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border rounded">Cancel</button>
          <button
            onClick={() => createM.mutate()}
            disabled={!preview || groupIds.length === 0 || createM.isPending}
            className="px-4 py-1.5 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded font-semibold disabled:opacity-50 flex items-center gap-1.5"
          >
            {createM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Schedule campaign
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 border rounded p-2">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</div>
      <div className="font-semibold text-sm">{value}</div>
    </div>
  )
}

// ─── Campaigns Tab ────────────────────────────────────────────────────────────

interface CampaignRow {
  id: number
  name: string
  subject: string
  status: 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'
  totalRecipients: number
  startAt: string
  finishedAt: string | null
  createdAt: string
  counts: Record<string, number>
}

function CampaignsTab() {
  const qc = useQueryClient()
  const [openId, setOpenId] = useState<number | null>(null)
  // Sub-tab filter — mirrors the four life-cycle states a campaign travels
  // through. "All" is the default so admins get the historical view; the
  // status pills above the table make the current phase obvious at a glance.
  type LifecycleTab = 'all' | 'pending' | 'ongoing' | 'completed' | 'cancelled'
  const [lifecycle, setLifecycle] = useState<LifecycleTab>('all')

  const { data, isLoading } = useQuery<{ data: CampaignRow[]; total: number }>({
    queryKey: ['campaigns', 'list'],
    queryFn: campaignsApi.list,
    refetchInterval: 15_000, // keep status fresh while a campaign is running
  })

  const pauseM = useMutation({
    mutationFn: (id: number) => campaignsApi.pause(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', 'list'] }),
  })
  const resumeM = useMutation({
    mutationFn: (id: number) => campaignsApi.resume(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', 'list'] }),
  })
  const cancelM = useMutation({
    mutationFn: (id: number) => campaignsApi.cancel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', 'list'] }),
  })

  const allRows = data?.data ?? []
  // Count once, filter once — badges on the pills reflect the same source
  // as the table so users never see "5 pending" on the pill and a different
  // number of pending rows below.
  const counts = useMemo(() => {
    const c = { all: allRows.length, pending: 0, ongoing: 0, completed: 0, cancelled: 0 }
    for (const r of allRows) {
      if (r.status === 'SCHEDULED' || r.status === 'DRAFT') c.pending++
      else if (r.status === 'RUNNING' || r.status === 'PAUSED') c.ongoing++
      else if (r.status === 'COMPLETED') c.completed++
      else if (r.status === 'CANCELLED') c.cancelled++
    }
    return c
  }, [allRows])
  const filteredRows = useMemo(() => {
    switch (lifecycle) {
      case 'pending': return allRows.filter((r) => r.status === 'SCHEDULED' || r.status === 'DRAFT')
      case 'ongoing': return allRows.filter((r) => r.status === 'RUNNING' || r.status === 'PAUSED')
      case 'completed': return allRows.filter((r) => r.status === 'COMPLETED')
      case 'cancelled': return allRows.filter((r) => r.status === 'CANCELLED')
      default: return allRows
    }
  }, [allRows, lifecycle])

  // Sortable columns — click a header to cycle (asc → desc → default). Default
  // is "startAt desc" which matches the API's natural order. Sort is stable
  // on the filtered rows so lifecycle + sort compose without surprises.
  type SortKey = 'name' | 'status' | 'progress' | 'opens' | 'replies' | 'starts'
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const toggleSort = (k: SortKey) => {
    if (sortKey !== k) { setSortKey(k); setSortDir('asc'); return }
    if (sortDir === 'asc') { setSortDir('desc'); return }
    setSortKey(null); setSortDir('desc')
  }
  const rows = useMemo(() => {
    if (!sortKey) return filteredRows
    const dir = sortDir === 'asc' ? 1 : -1
    const cmp = (a: CampaignRow, b: CampaignRow): number => {
      switch (sortKey) {
        case 'name': return a.name.localeCompare(b.name) * dir
        case 'status': return a.status.localeCompare(b.status) * dir
        case 'progress': {
          const sa = (a.counts.SENT || 0) + (a.counts.DELIVERED || 0) + (a.counts.REPLIED || 0)
          const sb = (b.counts.SENT || 0) + (b.counts.DELIVERED || 0) + (b.counts.REPLIED || 0)
          const pa = a.totalRecipients > 0 ? sa / a.totalRecipients : 0
          const pb = b.totalRecipients > 0 ? sb / b.totalRecipients : 0
          return (pa - pb) * dir
        }
        case 'opens': return ((a.counts.OPENED || 0) - (b.counts.OPENED || 0)) * dir
        case 'replies': return ((a.counts.REPLIED || 0) - (b.counts.REPLIED || 0)) * dir
        case 'starts': return (new Date(a.startAt).getTime() - new Date(b.startAt).getTime()) * dir
      }
    }
    return [...filteredRows].sort(cmp)
  }, [filteredRows, sortKey, sortDir])

  const sortArrow = (k: SortKey) => sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  const thSortableCls = 'px-3 py-2 font-medium cursor-pointer hover:text-foreground select-none'

  const pillCls = (active: boolean) =>
    `px-3 py-1.5 text-xs rounded-full font-semibold border ${active ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground hover:bg-accent'}`

  return (
    <div className="space-y-3">
      {/* Lifecycle sub-tabs — Pending / Ongoing / Completed / Cancelled */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setLifecycle('all')} className={pillCls(lifecycle === 'all')}>All <span className="opacity-70 ml-1">({counts.all})</span></button>
        <button onClick={() => setLifecycle('pending')} className={pillCls(lifecycle === 'pending')}>Pending <span className="opacity-70 ml-1">({counts.pending})</span></button>
        <button onClick={() => setLifecycle('ongoing')} className={pillCls(lifecycle === 'ongoing')}>Ongoing <span className="opacity-70 ml-1">({counts.ongoing})</span></button>
        <button onClick={() => setLifecycle('completed')} className={pillCls(lifecycle === 'completed')}>Completed <span className="opacity-70 ml-1">({counts.completed})</span></button>
        <button onClick={() => setLifecycle('cancelled')} className={pillCls(lifecycle === 'cancelled')}>Cancelled <span className="opacity-70 ml-1">({counts.cancelled})</span></button>
      </div>

      <div className="bg-card border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading campaigns…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            {lifecycle === 'all'
              ? 'No campaigns yet. Schedule one from the Compose tab.'
              : `No ${lifecycle} campaigns.`}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground bg-muted/30">
                <th className={thSortableCls} onClick={() => toggleSort('name')}>Campaign{sortArrow('name')}</th>
                <th className={thSortableCls} onClick={() => toggleSort('status')}>Status{sortArrow('status')}</th>
                <th className={thSortableCls} onClick={() => toggleSort('progress')}>Progress{sortArrow('progress')}</th>
                <th className={thSortableCls} onClick={() => toggleSort('opens')}>Opens{sortArrow('opens')}</th>
                <th className={thSortableCls} onClick={() => toggleSort('replies')}>Replies{sortArrow('replies')}</th>
                <th className={thSortableCls} onClick={() => toggleSort('starts')}>Starts{sortArrow('starts')}</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const sent = (c.counts.SENT || 0) + (c.counts.DELIVERED || 0) + (c.counts.REPLIED || 0)
                const failed = (c.counts.FAILED || 0) + (c.counts.BOUNCED || 0)
                const opened = c.counts.OPENED || 0
                const pct = c.totalRecipients > 0 ? Math.round(((sent + failed) / c.totalRecipients) * 100) : 0
                // Open rate is measured against messages that actually left the
                // building — sending to 100 people but only reaching 20 shouldn't
                // dilute the open rate with 80 never-delivered rows.
                const openPct = sent > 0 ? Math.round((opened * 100) / sent) : 0
                return (
                  <tr key={c.id} className="border-b hover:bg-muted/20 cursor-pointer" onClick={() => setOpenId(c.id)}>
                    <td className="px-3 py-2">
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-md">{c.subject}</div>
                    </td>
                    <td className="px-3 py-2"><CampaignStatusBadge status={c.status} /></td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-1.5 bg-muted rounded overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{sent}/{c.totalRecipients}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-semibold text-sky-700">{opened}</span>
                      {sent > 0 && <span className="text-xs text-muted-foreground ml-1">({openPct}%)</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-semibold text-violet-700">{c.counts.REPLIED || 0}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{formatDateTime(c.startAt)}</td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        {c.status === 'RUNNING' && (
                          <button onClick={() => pauseM.mutate(c.id)} className="p-1 hover:bg-muted rounded" title="Pause"><Pause className="h-3.5 w-3.5" /></button>
                        )}
                        {c.status === 'PAUSED' && (
                          <button onClick={() => resumeM.mutate(c.id)} className="p-1 hover:bg-muted rounded" title="Resume"><Play className="h-3.5 w-3.5" /></button>
                        )}
                        {(c.status === 'SCHEDULED' || c.status === 'RUNNING' || c.status === 'PAUSED') && (
                          <button onClick={() => { if (confirm('Cancel campaign?')) cancelM.mutate(c.id) }} className="p-1 hover:bg-rose-50 text-rose-600 rounded" title="Cancel"><StopCircle className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {openId != null && <CampaignDetailModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function CampaignStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    SCHEDULED: 'bg-blue-100 text-blue-700',
    RUNNING: 'bg-emerald-100 text-emerald-700',
    PAUSED: 'bg-amber-100 text-amber-700',
    COMPLETED: 'bg-indigo-100 text-indigo-700',
    CANCELLED: 'bg-rose-100 text-rose-700',
  }
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${map[status] ?? 'bg-gray-100 text-gray-700'}`}>{status}</span>
}

interface CampaignRecipient {
  id: number
  toEmail: string
  toName: string | null
  status: string
  sentAt: string | null
  openedAt: string | null
  repliedAt: string | null
  errorMessage: string | null
  group: { id: number; name: string; fromEmail: string } | null
  lead: { id: number; name: string } | null
}
interface CampaignDetail {
  campaign: CampaignRow & { bodyHtml: string }
  recipients: CampaignRecipient[]
}

function CampaignDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, isLoading } = useQuery<CampaignDetail>({
    queryKey: ['campaigns', 'detail', id],
    queryFn: () => campaignsApi.get(id),
    refetchInterval: 10_000,
  })

  const [filter, setFilter] = useState<string>('')
  const filtered = useMemo(
    () => data?.recipients.filter((r) => !filter || r.status === filter) ?? [],
    [data, filter],
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-card border rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b bg-muted/30 flex items-center justify-between">
          <div>
            <h3 className="font-bold">{data?.campaign.name ?? 'Campaign'}</h3>
            <p className="text-xs text-muted-foreground">{data?.campaign.subject}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {isLoading || !data ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…</div>
          ) : (
            <>
              {/* Per-hour send activity, coloured by sending account. When the
                  campaign fans out across multiple mailboxes each one appears as
                  its own bar in the same hour — that's the visual proof that
                  the accounts run in PARALLEL (all starting at the campaign's
                  startAt) rather than one after another. */}
              <CampaignTimelineChart recipients={data.recipients} startAt={data.campaign.startAt} />

              {/* Per-sending-account breakdown — answers "which mailbox sent
                  how much, and how did each perform?". Open rate uses the
                  actually-sent count (not the assigned share) so a mailbox
                  that's only halfway through doesn't get penalised for its
                  still-queued recipients. */}
              <CampaignPerAccountBreakdown recipients={data.recipients} />

              <div className="flex items-center gap-2 flex-wrap">
                {['', 'QUEUED', 'SENT', 'BOUNCED', 'FAILED', 'REPLIED'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilter(s)}
                    className={`px-2 py-1 text-xs border rounded ${filter === s ? 'bg-primary text-primary-foreground' : ''}`}
                  >
                    {s || 'All'}
                  </button>
                ))}
                <span className="text-xs text-muted-foreground ml-auto">
                  {filtered.length} of {data.recipients.length} recipients shown
                </span>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground bg-muted/20 text-xs">
                      <th className="px-3 py-1.5 font-medium">Recipient</th>
                      <th className="px-3 py-1.5 font-medium">Sent via</th>
                      <th className="px-3 py-1.5 font-medium">Status</th>
                      <th className="px-3 py-1.5 font-medium">Sent at</th>
                      <th className="px-3 py-1.5 font-medium">Opened</th>
                      <th className="px-3 py-1.5 font-medium">Reply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 500).map((r) => (
                      <tr key={r.id} className="border-b">
                        <td className="px-3 py-1.5">
                          <div className="font-medium">{r.toName ?? r.toEmail}</div>
                          <div className="text-xs text-muted-foreground">{r.toEmail}</div>
                        </td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.group?.fromEmail ?? '—'}</td>
                        <td className="px-3 py-1.5"><CampaignStatusBadge status={r.status} /></td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground whitespace-nowrap">{r.sentAt ? formatDateTime(r.sentAt) : '—'}</td>
                        <td className="px-3 py-1.5 text-xs">
                          {r.openedAt ? (
                            <span className="inline-flex items-center gap-1 text-sky-700 font-semibold">
                              <Eye className="h-3 w-3" /> {formatDateTime(r.openedAt)}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-xs">
                          {r.repliedAt ? (
                            <span className="text-violet-700 font-semibold">replied {formatDateTime(r.repliedAt)}</span>
                          ) : r.errorMessage ? (
                            <span className="text-rose-700 truncate max-w-xs inline-block" title={r.errorMessage}>{r.errorMessage.slice(0, 60)}</span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length > 500 && (
                  <div className="px-3 py-2 border-t text-xs text-muted-foreground">Showing first 500 of {filtered.length}.</div>
                )}
              </div>

              <div className="border rounded-lg p-4">
                <div className="text-xs text-muted-foreground mb-2 font-semibold">Email body (as sent)</div>
                <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: data.campaign.bodyHtml }} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Bar chart of per-hour send activity, one coloured stack per sending account.
// When a campaign uses multiple mailboxes each shows up as its own bar in the
// same hour bucket — the "parallel senders" visualisation the admin asked for.
// Buckets are anchored to the campaign's startAt so hour 0 = the moment the
// first mail went out (matches the schedule preview's "Hour 1" labelling).
function CampaignTimelineChart({
  recipients,
  startAt,
}: {
  recipients: CampaignRecipient[]
  startAt: string
}) {
  const chartData = useMemo(() => {
    const sent = recipients.filter((r) => r.sentAt)
    if (sent.length === 0) return { rows: [] as Array<Record<string, number | string>>, groups: [] as string[] }

    const anchor = new Date(startAt).getTime()
    const perGroupCounts = new Map<string, Map<number, number>>()
    const groupSet = new Set<string>()
    let minHour = Infinity
    let maxHour = -Infinity
    for (const r of sent) {
      const groupKey = r.group?.fromEmail || 'default'
      groupSet.add(groupKey)
      const t = new Date(r.sentAt!).getTime()
      const hour = Math.max(0, Math.floor((t - anchor) / 3_600_000))
      if (hour < minHour) minHour = hour
      if (hour > maxHour) maxHour = hour
      const groupBucket = perGroupCounts.get(groupKey) ?? new Map<number, number>()
      groupBucket.set(hour, (groupBucket.get(hour) ?? 0) + 1)
      perGroupCounts.set(groupKey, groupBucket)
    }

    // Contiguous hours between first and last activity — an empty hour still
    // shows so gaps between chunks are visible on the axis.
    const rows: Array<Record<string, number | string>> = []
    for (let h = minHour; h <= maxHour; h++) {
      const row: Record<string, number | string> = {
        hour: `H${h + 1}`,
        label: new Date(anchor + h * 3_600_000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' }),
      }
      for (const g of groupSet) row[g] = perGroupCounts.get(g)?.get(h) ?? 0
      rows.push(row)
    }
    return { rows, groups: Array.from(groupSet) }
  }, [recipients, startAt])

  if (chartData.rows.length === 0) {
    return (
      <div className="bg-muted/20 border rounded-lg p-4 text-xs text-muted-foreground text-center">
        No mails sent yet — the timeline chart will populate as the campaign runs.
      </div>
    )
  }

  // Distinct-but-friendly palette: cycled per account so multi-mailbox campaigns
  // stay legible without pulling in a full brand system.
  const palette = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#8b5cf6', '#ec4899', '#14b8a6']

  return (
    <div className="bg-card border rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b bg-muted/30 text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
        <span>Send activity · per hour</span>
        <span className="text-[10px] normal-case font-normal">
          {chartData.groups.length} account{chartData.groups.length === 1 ? '' : 's'} · anchored to campaign start
        </span>
      </div>
      <div className="p-3" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData.rows} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={30} />
            <ReTooltip
              contentStyle={{ fontSize: 12, borderRadius: 6 }}
              labelFormatter={(_h, payload) => {
                const label = payload?.[0]?.payload?.label
                return label ? String(label) : String(_h)
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {chartData.groups.map((g, i) => (
              <Bar key={g} dataKey={g} stackId="senders" fill={palette[i % palette.length]} name={g} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// Per-sending-account roll-up for one campaign. Groups recipients by the
// mailbox they were routed through and shows assigned / sent / opened /
// replied / failed / bounced counts plus rates. When only one account is
// picked this collapses to a single row — same numbers as the header stats,
// so nothing feels duplicated; the value shows up when a campaign fans out
// across multiple mailboxes.
function CampaignPerAccountBreakdown({ recipients }: { recipients: CampaignRecipient[] }) {
  const rows = useMemo(() => {
    interface Bucket {
      key: string
      fromEmail: string
      name: string
      assigned: number
      sent: number
      opened: number
      replied: number
      failed: number
      bounced: number
      queued: number
    }
    const byKey = new Map<string, Bucket>()
    for (const r of recipients) {
      const key = r.group ? `g${r.group.id}` : 'unassigned'
      let b = byKey.get(key)
      if (!b) {
        b = {
          key,
          fromEmail: r.group?.fromEmail || '—',
          name: r.group?.name || 'Unassigned',
          assigned: 0, sent: 0, opened: 0, replied: 0, failed: 0, bounced: 0, queued: 0,
        }
        byKey.set(key, b)
      }
      b.assigned++
      // SENT + REPLIED both count as "left the outbox" — replies presuppose
      // a delivered message, and the funnel already models REPLIED as a
      // sub-state of SENT elsewhere (see the campaigns list computation).
      if (r.status === 'SENT' || r.status === 'DELIVERED' || r.status === 'REPLIED') b.sent++
      if (r.status === 'QUEUED') b.queued++
      if (r.status === 'FAILED') b.failed++
      if (r.status === 'BOUNCED') b.bounced++
      if (r.openedAt) b.opened++
      if (r.repliedAt || r.status === 'REPLIED') b.replied++
    }
    return Array.from(byKey.values()).sort((a, b) => b.assigned - a.assigned)
  }, [recipients])

  if (rows.length === 0) return null

  const pct = (num: number, denom: number) => denom > 0 ? Math.round((num * 100) / denom) : 0
  const totals = rows.reduce(
    (acc, r) => ({
      assigned: acc.assigned + r.assigned,
      sent: acc.sent + r.sent,
      opened: acc.opened + r.opened,
      replied: acc.replied + r.replied,
      failed: acc.failed + r.failed,
      bounced: acc.bounced + r.bounced,
      queued: acc.queued + r.queued,
    }),
    { assigned: 0, sent: 0, opened: 0, replied: 0, failed: 0, bounced: 0, queued: 0 },
  )

  return (
    <div className="bg-card border rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b bg-muted/30 text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
        <span>Per-account breakdown · which mailbox sent what</span>
        <span className="text-[10px] normal-case font-normal">{rows.length} account{rows.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground bg-muted/10 text-xs">
              <th className="px-3 py-1.5 font-medium">Account</th>
              <th className="px-3 py-1.5 font-medium text-right">Assigned</th>
              <th className="px-3 py-1.5 font-medium text-right">Sent</th>
              <th className="px-3 py-1.5 font-medium text-right">Queued</th>
              <th className="px-3 py-1.5 font-medium text-right">Opened</th>
              <th className="px-3 py-1.5 font-medium text-right">Replied</th>
              <th className="px-3 py-1.5 font-medium text-right">Failed</th>
              <th className="px-3 py-1.5 font-medium text-right">Bounced</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b hover:bg-muted/10">
                <td className="px-3 py-1.5">
                  <div className="font-semibold">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.fromEmail}</div>
                </td>
                <td className="px-3 py-1.5 text-right font-semibold">{r.assigned.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right">
                  <span className="font-semibold text-emerald-700">{r.sent.toLocaleString()}</span>
                  {r.assigned > 0 && <span className="text-xs text-muted-foreground ml-1">({pct(r.sent, r.assigned)}%)</span>}
                </td>
                <td className="px-3 py-1.5 text-right text-amber-700">{r.queued || <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-1.5 text-right">
                  <span className="font-semibold text-sky-700">{r.opened.toLocaleString()}</span>
                  {r.sent > 0 && <span className="text-xs text-muted-foreground ml-1">({pct(r.opened, r.sent)}%)</span>}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <span className="font-semibold text-violet-700">{r.replied.toLocaleString()}</span>
                  {r.sent > 0 && <span className="text-xs text-muted-foreground ml-1">({pct(r.replied, r.sent)}%)</span>}
                </td>
                <td className="px-3 py-1.5 text-right text-rose-700">{r.failed || <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-1.5 text-right text-rose-700">{r.bounced || <span className="text-muted-foreground">—</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-muted/20">
            <tr className="text-xs font-semibold">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2 text-right">{totals.assigned.toLocaleString()}</td>
              <td className="px-3 py-2 text-right text-emerald-700">
                {totals.sent.toLocaleString()}
                {totals.assigned > 0 && <span className="text-muted-foreground font-normal ml-1">({pct(totals.sent, totals.assigned)}%)</span>}
              </td>
              <td className="px-3 py-2 text-right text-amber-700">{totals.queued}</td>
              <td className="px-3 py-2 text-right text-sky-700">
                {totals.opened.toLocaleString()}
                {totals.sent > 0 && <span className="text-muted-foreground font-normal ml-1">({pct(totals.opened, totals.sent)}%)</span>}
              </td>
              <td className="px-3 py-2 text-right text-violet-700">
                {totals.replied.toLocaleString()}
                {totals.sent > 0 && <span className="text-muted-foreground font-normal ml-1">({pct(totals.replied, totals.sent)}%)</span>}
              </td>
              <td className="px-3 py-2 text-right text-rose-700">{totals.failed}</td>
              <td className="px-3 py-2 text-right text-rose-700">{totals.bounced}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="px-3 py-2 border-t text-[11px] text-muted-foreground bg-muted/10">
        Open rate is measured against mails that actually left this account, not the assigned share, so a mailbox that's still dripping isn't dragged down by its queued recipients.
      </div>
    </div>
  )
}

// ─── Reports Tab ──────────────────────────────────────────────────────────────
// Roll-up view over all campaigns. Uses the same /campaigns list endpoint —
// no extra backend surface — and derives every rate from the per-campaign
// `counts` map the backend already returns.

type ReportBucket = 'total' | 'sent' | 'queued' | 'opened' | 'replied' | 'pending' | 'failed' | 'bounced'

function ReportsTab() {
  // Per-campaign performance list still uses /campaigns list — same data as the
  // Campaigns tab, so no extra roundtrip on that side.
  // ONE unified funnel across campaigns AND quick sends — see
  // /communication/mail-reports/summary. This replaces the two separate tile
  // rows admins found confusing (numbers appeared twice, made reconciliation
  // hard). Now Total / Sent / Queued / Opened / Reply / Pending / Fail /
  // Bounce all live in a single row.
  const { data: summary, isLoading: sumLoading } = useQuery({
    queryKey: ['comm', 'mail-reports-summary'],
    queryFn: communicationApi.mailReportsSummary,
    refetchInterval: 30_000,
  })

  const [openBucket, setOpenBucket] = useState<ReportBucket | null>(null)

  const pct = (num: number, denom: number) => denom > 0 ? Math.round((num * 100) / denom) : 0

  if (sumLoading || !summary) {
    return <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading reports…</div>
  }

  // Tile config drives both the render and the drill-down click. Order is the
  // funnel order — audience total, then delivery states, then drop-offs.
  const tiles: {
    bucket: ReportBucket
    label: string
    value: number
    sub: string
    tint: 'slate' | 'emerald' | 'sky' | 'violet' | 'rose' | 'amber'
  }[] = [
    { bucket: 'total',   label: 'Total',   value: summary.total,   sub: 'Total Mails',                                       tint: 'slate' },
    { bucket: 'sent',    label: 'Sent',    value: summary.sent,    sub: `${pct(summary.sent, summary.total)}% delivered`, tint: 'emerald' },
    { bucket: 'queued',  label: 'Queued',  value: summary.queued,  sub: `${pct(summary.queued, summary.total)}% waiting`, tint: 'amber' },
    { bucket: 'opened',  label: 'Opened',  value: summary.opened,  sub: `${pct(summary.opened, summary.sent)}% open rate`, tint: 'sky' },
    { bucket: 'replied', label: 'Reply',   value: summary.replied, sub: `${pct(summary.replied, summary.sent)}% reply rate`, tint: 'violet' },
    { bucket: 'pending', label: 'Pending', value: summary.pending, sub: summary.pending > 0 ? 'still sending' : '—',      tint: 'amber' },
    { bucket: 'failed',  label: 'Fail',    value: summary.failed,  sub: `${pct(summary.failed, summary.total)}% failed`,   tint: 'rose' },
    { bucket: 'bounced', label: 'Bounce',  value: summary.bounced, sub: `${pct(summary.bounced, summary.total)}% bounce`,  tint: 'rose' },
  ]

  return (
    <div className="space-y-4">
      {/* Single unified funnel — click any tile to drill down into the actual
          messages in that bucket. Same set covers both scheduled campaigns and
          quick sends so reconciliation is trivial. */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-muted/30 text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
          <span>Mail pipeline · all sources</span>
          <span className="text-[10px] normal-case font-normal text-muted-foreground">campaigns + quick sends · click a tile to drill down</span>
        </div>
        <div className="p-3 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          {tiles.map((t) => (
            <ReportTile
              key={t.bucket}
              label={t.label}
              value={t.value.toLocaleString()}
              sub={t.sub}
              tint={t.tint}
              active={openBucket === t.bucket}
              onClick={() => setOpenBucket((prev) => (prev === t.bucket ? null : t.bucket))}
            />
          ))}
        </div>
        {openBucket && <DrilldownPanel bucket={openBucket} onClose={() => setOpenBucket(null)} />}
      </div>

      {/* <div className="bg-card border rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-muted/30 text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
          <span>Per-campaign performance</span>
          <span className="text-[10px] normal-case font-normal text-muted-foreground">newest first · same funnel order</span>
        </div>
        {rows.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">No campaigns yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground bg-muted/20">
                  <th className="px-3 py-2 font-medium">Campaign</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Total</th>
                  <th className="px-3 py-2 font-medium text-right">Queued</th>
                  <th className="px-3 py-2 font-medium text-right">Sent</th>
                  <th className="px-3 py-2 font-medium text-right">Opened</th>
                  <th className="px-3 py-2 font-medium text-right">Replied</th>
                  <th className="px-3 py-2 font-medium text-right">Bounced</th>
                  <th className="px-3 py-2 font-medium text-right">Failed</th>
                  <th className="px-3 py-2 font-medium">Started</th>
                  <th className="px-3 py-2 font-medium">Finished</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const total = c.totalRecipients
                  const queued = c.counts.QUEUED || 0
                  const sent = (c.counts.SENT || 0) + (c.counts.DELIVERED || 0) + (c.counts.REPLIED || 0)
                  const opened = c.counts.OPENED || 0
                  const replied = c.counts.REPLIED || 0
                  const bounced = c.counts.BOUNCED || 0
                  const failed = c.counts.FAILED || 0
                  return (
                    <tr key={c.id} className="border-b hover:bg-muted/20">
                      <td className="px-3 py-2">
                        <div className="font-semibold">{c.name}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-md">{c.subject}</div>
                      </td>
                      <td className="px-3 py-2"><CampaignStatusBadge status={c.status} /></td>
                      <td className="px-3 py-2 text-right font-semibold">{total.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-amber-700">{queued || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2 text-right">
                        <span className="font-semibold text-emerald-700">{sent}</span>
                        {total > 0 && <span className="text-xs text-muted-foreground ml-1">({pct(sent, total)}%)</span>}
                      </td>
                      <td className="px-3 py-2 text-right"><Rate num={opened} denom={sent} tint="sky" /></td>
                      <td className="px-3 py-2 text-right"><Rate num={replied} denom={sent} tint="violet" /></td>
                      <td className="px-3 py-2 text-right"><Rate num={bounced} denom={total} tint="rose" /></td>
                      <td className="px-3 py-2 text-right text-amber-700">{failed || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatDateTime(c.startAt)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{c.finishedAt ? formatDateTime(c.finishedAt) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div> */}

      <div className="text-[11px] text-muted-foreground leading-relaxed">
        <strong>How to read this:</strong> Recipients → Queued → Sent → Opened → Replied is the funnel a mail follows.
        Bounced / Failed are drop-offs before send lands. Open %  and Reply % are of leads we actually delivered to
        (not of the audience) so the numbers stay meaningful when a campaign is still dripping.
        Opens rely on a 1×1 tracking pixel — Apple Mail Privacy Protection and some corporate proxies pre-fetch or
        block it, so opens are directionally accurate rather than exact.
      </div>
    </div>
  )
}

function ReportTile({
  label, value, sub, tint, onClick, active,
}: {
  label: string
  value: string
  sub?: string
  tint: 'slate' | 'emerald' | 'sky' | 'violet' | 'rose' | 'amber'
  onClick?: () => void
  active?: boolean
}) {
  const tints: Record<string, string> = {
    slate: 'text-slate-700',
    emerald: 'text-emerald-700',
    sky: 'text-sky-700',
    violet: 'text-violet-700',
    rose: 'text-rose-700',
    amber: 'text-amber-700',
  }
  const ringByTint: Record<string, string> = {
    slate: 'ring-slate-400',
    emerald: 'ring-emerald-400',
    sky: 'ring-sky-400',
    violet: 'ring-violet-400',
    rose: 'ring-rose-400',
    amber: 'ring-amber-400',
  }
  const clickable = !!onClick
  const activeCls = active ? `ring-2 ${ringByTint[tint]} bg-muted/30` : ''
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={`bg-card border rounded-lg p-3 text-left w-full transition ${clickable ? 'hover:bg-muted/30 cursor-pointer' : 'cursor-default'} ${activeCls}`}
      title={clickable ? `Show ${label.toLowerCase()} messages` : undefined}
    >
      <div className="text-[10px] uppercase text-muted-foreground tracking-wider font-semibold">{label}</div>
      <div className={`text-2xl font-bold ${tints[tint]}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </button>
  )
}

// Drill-down list for whichever tile the admin clicked. Merges quick sends and
// campaign recipients so the admin sees ONE list per bucket — no jumping to the
// Campaigns tab to find the failing rows. Errors get their message inline so
// "which one had the SMTP error?" answers itself.
interface DrilldownRow {
  source: 'quick' | 'campaign'
  id: number
  leadId: number | null
  toEmail: string
  toName: string | null
  subject: string
  body?: string
  status: string | null
  sentAt: string | null
  openedAt: string | null
  repliedAt: string | null
  errorMessage: string | null
  createdAt: string
  campaignId: number | null
  campaignName: string | null
  group: { id: number; name: string; fromEmail: string } | null
}

function DrilldownPanel({ bucket, onClose }: { bucket: ReportBucket; onClose: () => void }) {
  const { data, isLoading, error } = useQuery<{ bucket: string; rows: DrilldownRow[] }>({
    queryKey: ['comm', 'mail-reports-drilldown', bucket],
    queryFn: () => communicationApi.mailReportsDrilldown(bucket),
  })

  // Click a row → open the same read-only preview modal Send History uses.
  // The drilldown response now carries `body` on both sources, so no extra
  // fetch is needed to render the message.
  const [preview, setPreview] = useState<DrilldownRow | null>(null)

  return (
    <div className="border-t bg-muted/10">
      <div className="px-4 py-2 flex items-center justify-between text-xs">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          {bucket} · {data?.rows.length ?? 0} shown{data && data.rows.length >= 200 ? ' (first 200)' : ''}
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground flex items-center gap-1">
          <X className="h-3.5 w-3.5" /> Close
        </button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <div className="p-4 text-sm text-rose-700">Failed to load drill-down.</div>
      ) : !data || data.rows.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">No messages in this bucket yet.</div>
      ) : (
        <div className="max-h-96 overflow-y-auto divide-y">
          {data.rows.map((r) => (
            <button
              key={`${r.source}-${r.id}`}
              type="button"
              onClick={() => setPreview(r)}
              className="w-full text-left px-4 py-2.5 hover:bg-accent/20 flex items-start gap-3"
              title="Open this mail"
            >
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
                  r.source === 'campaign' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-700'
                }`}
                title={r.source === 'campaign' ? 'Scheduled campaign recipient' : 'Quick send'}
              >
                {r.source === 'campaign' ? 'CAMPAIGN' : 'QUICK'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm truncate">{r.subject || '(no subject)'}</span>
                  {r.campaignName && (
                    <span className="text-[10px] text-muted-foreground">· {r.campaignName}</span>
                  )}
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-semibold uppercase">
                    {r.status || 'sent'}
                  </span>
                  {r.group && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                      via {r.group.fromEmail}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate flex items-center gap-1 flex-wrap">
                  <span>To: {r.toName ? `${r.toName} <${r.toEmail}>` : r.toEmail}</span>
                  <CopyButton text={r.toEmail} title="Copy recipient email" />
                  {r.leadId && <span className="text-muted-foreground">·</span>}
                  {r.leadId && <LeadLinkChip id={r.leadId} />}
                </div>
                {r.errorMessage && (
                  <div className="text-xs text-rose-700 mt-0.5 truncate" title={r.errorMessage}>
                    Error: {r.errorMessage}
                  </div>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground text-right shrink-0">
                <div className="whitespace-nowrap">{formatDateTime(r.createdAt)}</div>
                {r.openedAt && <div className="text-sky-700 whitespace-nowrap">opened {formatDateTime(r.openedAt)}</div>}
                {r.repliedAt && <div className="text-violet-700 whitespace-nowrap">replied {formatDateTime(r.repliedAt)}</div>}
              </div>
            </button>
          ))}
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-card border rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
          >
            <div className="px-5 py-4 border-b bg-muted/30 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-bold truncate">{preview.subject || '(no subject)'}</h3>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {preview.source === 'campaign' ? (
                    <>
                      <span className="text-violet-700 font-semibold">CAMPAIGN</span>
                      {preview.campaignName && <> · {preview.campaignName}</>}
                    </>
                  ) : (
                    <span className="text-emerald-700 font-semibold">DIRECT</span>
                  )}
                  {' · '}To: {preview.toName ? `${preview.toName} <${preview.toEmail}>` : preview.toEmail}
                  {preview.group && <> · via {preview.group.fromEmail}</>}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {preview.sentAt ? <>Sent {formatDateTime(preview.sentAt)}</> : <>Queued {formatDateTime(preview.createdAt)}</>}
                  {preview.openedAt && <span className="text-sky-700 ml-2">· opened {formatDateTime(preview.openedAt)}</span>}
                  {preview.repliedAt && <span className="text-violet-700 ml-2">· replied {formatDateTime(preview.repliedAt)}</span>}
                </p>
                {preview.errorMessage && (
                  <p className="text-xs text-rose-700 mt-1">Error: {preview.errorMessage}</p>
                )}
              </div>
              <button
                onClick={() => setPreview(null)}
                className="text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {preview.body ? (
              <div className="flex-1 overflow-hidden p-3 bg-muted/20">
                <HtmlPreview html={preview.body} empty="This message has no body." height={520} />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-6 text-sm text-muted-foreground text-center">
                Body isn't stored for this message.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function Rate({ num, denom, tint }: { num: number; denom: number; tint: 'sky' | 'violet' | 'rose' }) {
  if (denom <= 0) return <span className="text-muted-foreground">—</span>
  const p = Math.round((num * 100) / denom)
  const tints: Record<string, string> = {
    sky: 'text-sky-700',
    violet: 'text-violet-700',
    rose: 'text-rose-700',
  }
  return (
    <span>
      <span className={`font-semibold ${tints[tint]}`}>{p}%</span>
      <span className="text-xs text-muted-foreground ml-1">({num})</span>
    </span>
  )
}
