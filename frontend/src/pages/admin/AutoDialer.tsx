import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { autoDialerApi, type AutoDialerCampaign } from '@/lib/api'
import { Plus, PhoneOutgoing, Users, Clock, Play, Pause, CheckCircle2, FileEdit } from 'lucide-react'
import { NewCampaignWizard } from '@/components/auto-dialer/NewCampaignWizard'

const STATUS_BADGES: Record<AutoDialerCampaign['status'], { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }> = {
  draft:     { label: 'Draft',     cls: 'bg-muted text-muted-foreground',                                          icon: FileEdit },
  active:    { label: 'Active',    cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300', icon: Play },
  paused:    { label: 'Paused',    cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',     icon: Pause },
  completed: { label: 'Completed', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',         icon: CheckCircle2 },
}

export default function AutoDialer() {
  const [showWizard, setShowWizard] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')

  const listQ = useQuery({
    queryKey: ['auto-dialer', 'campaigns', statusFilter],
    queryFn: () => autoDialerApi.list(statusFilter ? { status: statusFilter } : undefined),
  })

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Auto Dialer</h1>
          <p className="text-sm text-muted-foreground">Automated outbound campaigns with recording playback</p>
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 text-sm font-medium"
        >
          <Plus className="h-4 w-4" /> New Campaign
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 text-sm">
        {['', 'draft', 'active', 'paused', 'completed'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full border ${statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'}`}
          >
            {s ? STATUS_BADGES[s as AutoDialerCampaign['status']].label : 'All'}
          </button>
        ))}
      </div>

      {/* Campaign cards */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {listQ.isLoading ? (
          <div className="col-span-full text-center text-muted-foreground py-12">Loading…</div>
        ) : (listQ.data?.data || []).length === 0 ? (
          <div className="col-span-full text-center text-muted-foreground py-12">No campaigns yet</div>
        ) : (listQ.data?.data || []).map((camp) => {
          const badge = STATUS_BADGES[camp.status]
          const Icon = badge.icon
          return (
            <Link
              key={camp.id}
              to="/app/auto-dialer/$id"
              params={{ id: String(camp.id) }}
              className="border rounded-lg p-4 hover:shadow-md transition-all space-y-3 group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold truncate group-hover:text-primary">{camp.name}</h3>
                  {camp.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{camp.description}</p>
                  )}
                </div>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${badge.cls} shrink-0`}>
                  <Icon className="h-3 w-3" /> {badge.label}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <Stat icon={<Users className="h-3 w-3" />} label="Contacts" value={camp.totalContacts || camp._count?.contacts || 0} />
                <Stat icon={<PhoneOutgoing className="h-3 w-3" />} label="Assigned" value={camp._count?.assignments || 0} />
                <Stat icon={<Clock className="h-3 w-3" />} label="Gap" value={`${camp.callGapSec}s`} />
              </div>

              <div className="text-[10px] text-muted-foreground flex items-center justify-between">
                <span>{camp.recording ? `🎙 ${camp.recording.name}` : 'No recording'}</span>
                <span>{new Date(camp.createdAt).toLocaleDateString()}</span>
              </div>
            </Link>
          )
        })}
      </div>

      {showWizard && <NewCampaignWizard onClose={() => setShowWizard(false)} />}
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <div className="flex items-center gap-1 text-muted-foreground">{icon}<span>{label}</span></div>
      <div className="font-semibold text-foreground">{value}</div>
    </div>
  )
}
