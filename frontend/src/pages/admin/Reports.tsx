import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { dashboardApi, reportsApi, leadsApi } from '@/lib/api'
import { downloadBlob } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import {
  BarChart3,
  TrendingUp,
  Users,
  AlertCircle,
  FileDown,
  Award,
  Calendar,
} from 'lucide-react'
import type { DashboardStats } from '@/types'
import { toast } from 'sonner'
import { CallActivitySection } from '@/components/reports/CallActivitySection'
import { CounsellorPerformanceSection } from '@/components/reports/CounsellorPerformanceSection'
import { SourceBreakdownSection } from '@/components/reports/SourceBreakdownSection'
import { MultiSelectDropdown } from '@/components/common/MultiSelectDropdown'
import { SalesReportSection } from '@/components/reports/SalesReportSection'

interface OverviewReport {
  total: number
  enrolled: number
  byWebsite: { website: string | null; count: number }[]
}

interface YearComparison {
  years: number[]
  totals: { year: number; total: number }[]
  rows: ({ month: string } & Record<string, number | string>)[]
}

export function Reports() {
  const userRole = useAuthStore((s) => s.user?.role)
  const isCounsellor = userRole === 'counsellor'
  const hasDeals = useAuthStore((s) => s.hasFeature)('deals')

  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [intrestedCourse, setIntrestedCourse] = useState<string[]>([])
  // Exporting leads is restricted to the top-level admin only.
  const canExport = useAuthStore((s) => s.isFullAdmin())

  if (isCounsellor) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <div className="h-12 w-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mb-3">
          <AlertCircle className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold mb-1">Reports & Analytics Access Restricted</h2>
        <p className="text-sm text-muted-foreground max-w-md mb-4">
          Team performance reports and overall source analytics are reserved for Admins, Sub-Admins, and Sales Heads.
          You can view your personal activity and calls under My Activity.
        </p>
        <Link to="/app/my-activity" className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90">
          Go to My Activity
        </Link>
      </div>
    )
  }

  const { data: courseValues = [] } = useQuery<string[]>({
    queryKey: ['lead-field-values', 'intrestedCourse'],
    queryFn: () => leadsApi.fieldValues('intrestedCourse'),
    staleTime: 5 * 60_000,
  })

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['dashboard', 'stats'],
    queryFn: dashboardApi.stats,
  })
  
  const courseFilterParam = intrestedCourse.length ? JSON.stringify(intrestedCourse) : undefined
  const { data: overview } = useQuery<OverviewReport>({
    queryKey: ['reports', 'overview', fromDate, toDate, courseFilterParam],
    queryFn: () => reportsApi.overview({ fromDate: fromDate || undefined, toDate: toDate || undefined, intrestedCourse: courseFilterParam }),
  })
  const { data: yoy } = useQuery<YearComparison>({
    queryKey: ['dashboard', 'year-comparison'],
    queryFn: () => dashboardApi.yearComparison(),
  })

  const handleExport = async () => {
    try {
      const params: Record<string, string> = {}
      if (fromDate) params.fromDate = fromDate
      if (toDate) params.toDate = toDate
      const blob = await leadsApi.exportCsv(params)
      downloadBlob(blob, `leads-report-${new Date().toISOString().slice(0, 10)}.csv`)
      toast.success('Export ready')
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Export failed')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reports & Analytics</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Lead performance overview</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            />
            <span className="text-muted-foreground">to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            />
          </div>
          {canExport && (
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border rounded-md hover:bg-accent"
            >
              <FileDown className="h-4 w-4" />
              Export CSV
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard title="Total Leads" value={overview?.total ?? stats?.totalLeads ?? 0} icon={<Users className="h-4 w-4" />} color="blue" />
        <StatCard title="Converted" value={overview?.enrolled ?? 0} icon={<Award className="h-4 w-4" />} color="green" />
        <StatCard title="This Week" value={stats?.weekLeads ?? 0} icon={<BarChart3 className="h-4 w-4" />} color="purple" />
        <StatCard title="Follow-ups (Today)" value={stats?.todayFollowups ?? 0} icon={<AlertCircle className="h-4 w-4" />} color="orange" />
      </div>

      <div className="bg-card border rounded-lg p-5">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="w-full sm:w-auto min-w-[200px]">
            <label className="text-xs font-semibold text-muted-foreground block mb-1">Product</label>
            <MultiSelectDropdown
              options={courseValues}
              value={intrestedCourse}
              onChange={setIntrestedCourse}
              placeholder="Any product"
              searchPlaceholder="Search product..."
            />
          </div>
        </div>
      </div>

      {hasDeals && <SalesReportSection />}

      <SourceBreakdownSection fromDate={fromDate} toDate={toDate} intrestedCourse={courseFilterParam} />

      <CounsellorPerformanceSection fromDate={fromDate} toDate={toDate} />

      <CallActivitySection fromDate={fromDate} toDate={toDate} />

      {yoy && yoy.years.length >= 2 && <YearOverYearChart data={yoy} />}

    </div>
  )
}

function YearOverYearChart({ data }: { data: YearComparison }) {
  const colors = ['#3b82f6', '#f59e0b', '#10b981', '#a855f7']
  const yearKeys = data.years.map(String)
  const max = Math.max(
    1,
    ...data.rows.flatMap((r) => yearKeys.map((y) => Number(r[y] || 0))),
  )

  return (
    <div className="bg-card border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Year-over-Year Comparison
        </h2>
        <div className="flex items-center gap-3 text-xs">
          {data.totals.map((t, i) => (
            <span key={t.year} className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ background: colors[i % colors.length] }}
              />
              {t.year}: <span className="font-semibold tabular-nums">{t.total.toLocaleString()}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-2 items-end h-40">
        {data.rows.map((r) => (
          <div key={r.month as string} className="flex flex-col items-center gap-1">
            <div className="flex items-end gap-0.5 h-32 w-full justify-center">
              {yearKeys.map((y, i) => {
                const v = Number(r[y] || 0)
                const h = (v / max) * 100
                return (
                  <div
                    key={y}
                    className="flex-1 rounded-t-sm min-w-[3px] transition-all hover:opacity-80"
                    style={{
                      height: `${Math.max(h, v ? 2 : 0)}%`,
                      background: colors[i % colors.length],
                    }}
                    title={`${y} ${r.month}: ${v}`}
                  />
                )
              })}
            </div>
            <div className="text-[10px] text-muted-foreground">{r.month as string}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatCard({
  title, value, icon, color,
}: {
  title: string
  value: number
  icon: React.ReactNode
  color: 'blue' | 'green' | 'purple' | 'orange'
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
  }
  return (
    <div className="bg-card border rounded-lg p-4">
      <div className={`inline-flex p-2 rounded-md ${colors[color]} mb-3`}>{icon}</div>
      <div className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{title}</div>
    </div>
  )
}
