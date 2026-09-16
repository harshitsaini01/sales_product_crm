import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  FolderKanban, Plus, Clock, Mail, Phone, MessageSquare, CalendarDays, IndianRupee,
  AlertTriangle, Handshake, ArrowRight, Users,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { compactMoney } from '@/lib/deals-api'
import { OPEN_STATUSES, type Project } from '@/lib/projects-api'
import { Block, SectionHead } from '@/components/crm/panels'
import { NewProjectModal } from './NewProjectModal'
import { NewDealModal } from '@/pages/admin/Deals'
import { useQuery } from '@tanstack/react-query'
import { pipelinesApi } from '@/lib/deals-api'
import { StatusBadge, PriorityMark, Avatar, when } from './bits'
import { cn } from '@/lib/utils'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The projects opened from a lead, on the lead's own page.
 *
 * The brief a rep types on the lead is where a project starts; this is where
 * it goes. "Start a project" pre-fills the title and description from that
 * brief and the client's address from the lead, so it is two clicks, not a
 * form.
 */
export function LeadProjects({ lead, biz, onChanged }: { lead: any; biz: any; onChanged: () => void }) {
  const [creating, setCreating] = useState(false)
  const me = useAuthStore((s) => s.user)
  const projects: Project[] = biz?.projects ?? []

  const defaults = {
    leadId: Number(lead.id),
    accountId: biz?.account?.id ?? null,
    title: biz?.business?.projectTitle ?? '',
    description: biz?.business?.projectDescription ?? '',
    clientName: lead.name ?? '',
    clientEmail: lead.email ?? '',
  }

  return (
    <Block>
      <SectionHead
        icon={FolderKanban}
        title="Projects"
        count={projects.length}
        action={{ label: '+ Start a project', onClick: () => setCreating(true) }}
      />

      {!projects.length ? (
        <button
          onClick={() => setCreating(true)}
          className="mt-2 flex w-full items-center gap-2.5 rounded-lg border border-dashed px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium">Hand this brief to a team.</span> Pick IT, Digital Marketing or whoever
            builds it, work the proposal with them, then send it to the client from the same thread.
          </span>
        </button>
      ) : (
        <div className="mt-2 space-y-1.5">
          {projects.map((p) => {
            const mine = p.ballWithUserId != null && p.ballWithUserId === me?.id
            const overdue = p.dueDate && OPEN_STATUSES.includes(p.status) && new Date(p.dueDate) < new Date()
            return (
              <Link
                key={p.id}
                to="/app/projects/$projectId"
                params={{ projectId: String(p.id) }}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-lg border p-2.5 text-sm transition-colors hover:border-primary/40',
                  mine && 'border-l-2 border-l-primary',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] font-semibold text-muted-foreground">{p.projectNumber}</span>
                    <StatusBadge status={p.status} />
                    <PriorityMark priority={p.priority} />
                    {mine && <span className="text-[10px] font-semibold text-primary">your move</span>}
                    {overdue && <span className="text-[10px] font-semibold text-rose-600">overdue</span>}
                  </div>
                  <p className="truncate font-medium">{p.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[p.team?.name, p.assignee ? `with ${p.assignee.name}` : null, `${p.messageCount} message${p.messageCount === 1 ? '' : 's'}`, when(p.updatedAt)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="flex -space-x-2">
                  {p.owner && <Avatar user={p.owner} size="sm" />}
                  {p.assignee && <Avatar user={p.assignee} size="sm" />}
                </div>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </Link>
            )
          })}
        </div>
      )}

      {creating && (
        <NewProjectModal
          open
          onClose={() => setCreating(false)}
          defaults={defaults}
          onCreated={onChanged}
        />
      )}
    </Block>
  )
}

/**
 * The company pulse — the strip the lead overview opens with.
 *
 * Five things, each one a fact with a consequence:
 *   last contact   → is this going cold
 *   next follow-up → what is already scheduled
 *   with the team  → is somebody working the brief
 *   with client    → is a proposal out, waiting on them
 *   owed           → is there money to chase
 *
 * Every tile is a button that goes to where you would act on it. A number you
 * cannot do anything about is decoration.
 */
export function CompanyPulse({
  lead,
  biz,
  followups,
  onGoToTab,
  projectsOn,
}: {
  lead: any
  biz: any
  followups: any[]
  onGoToTab: (tab: string) => void
  projectsOn: boolean
}) {
  const [creating, setCreating] = useState(false)
  const [dealing, setDealing] = useState(false)
  const hasDeals = useAuthStore((s) => s.hasFeature)('deals')
  const { data: pipelines = [] } = useQuery({ queryKey: ['pipelines'], queryFn: pipelinesApi.list, enabled: dealing })
  const stats = biz?.account?.stats
  const projects: Project[] = biz?.projects ?? []

  // Last contact: the account's own figure once converted, else the newest
  // follow-up on the lead. Same number the account page shows, on purpose.
  const lastFollowup = [...followups]
    .filter((f) => f.createdAt)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0]
  const daysSince: number | null =
    stats?.daysSinceContact ?? (lastFollowup ? Math.floor((Date.now() - +new Date(lastFollowup.createdAt)) / 86_400_000) : null)
  const stale = daysSince === null || daysSince >= 14

  const nextFollowup = [...followups]
    .filter((f) => f.followupDate && new Date(f.followupDate) >= new Date(new Date().toDateString()))
    .sort((a, b) => +new Date(a.followupDate) - +new Date(b.followupDate))[0]

  const withTeam = projects.filter((p) => ['assigned', 'in_review', 'proposal_ready'].includes(p.status))
  const withClient = projects.filter((p) => p.status === 'sent_to_client')
  const replied = projects.filter((p) => p.status === 'client_replied')
  const money = biz?.money

  const Tile = ({
    icon: Icon,
    label,
    value,
    sub,
    tone,
    onClick,
  }: {
    icon: React.ComponentType<{ className?: string }>
    label: string
    value: string
    sub?: string
    tone?: 'warn' | 'good' | 'accent'
    onClick?: () => void
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-w-0 items-start gap-2.5 rounded-lg border bg-card p-3 text-left transition-colors',
        onClick && 'hover:border-primary/40',
        tone === 'warn' && 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20',
        tone === 'good' && 'border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20',
        tone === 'accent' && 'border-primary/30 bg-primary/5',
      )}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'warn' ? 'text-amber-600' : tone === 'good' ? 'text-emerald-600' : 'text-muted-foreground')} />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn('truncate text-sm font-bold', tone === 'warn' && 'text-amber-700')}>{value}</p>
        {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </button>
  )

  return (
    <div className="space-y-2.5">
      <div className={cn('grid gap-2.5 sm:grid-cols-2', projectsOn ? 'lg:grid-cols-5' : 'lg:grid-cols-3')}>
        <Tile
          icon={Clock}
          label="Last contact"
          value={daysSince === null ? 'Never' : daysSince === 0 ? 'Today' : daysSince === 1 ? 'Yesterday' : `${daysSince} days ago`}
          sub={stats?.lastActivity?.subject ?? lastFollowup?.fStatus ?? (daysSince === null ? 'Nothing logged yet' : undefined)}
          tone={stale ? 'warn' : undefined}
          onClick={() => onGoToTab('timeline')}
        />
        <Tile
          icon={CalendarDays}
          label="Next follow-up"
          value={nextFollowup ? new Date(nextFollowup.followupDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'None set'}
          sub={nextFollowup?.fStatus ?? (nextFollowup ? undefined : 'Schedule one')}
          tone={nextFollowup ? undefined : 'warn'}
          onClick={() => onGoToTab('followups')}
        />
        {projectsOn && (
          <Tile
            icon={Users}
            label="With the team"
            value={withTeam.length ? `${withTeam.length} project${withTeam.length === 1 ? '' : 's'}` : 'Nothing'}
            sub={withTeam[0] ? `${withTeam[0].team?.name ?? 'team'} · ${withTeam[0].assignee?.name ?? 'unassigned'}` : 'Hand the brief to a team'}
            tone={withTeam.length ? 'accent' : undefined}
            onClick={() => (withTeam.length ? undefined : setCreating(true))}
          />
        )}
        {projectsOn && (
          <Tile
            icon={replied.length ? AlertTriangle : Mail}
            label={replied.length ? 'Client replied' : 'With client'}
            value={replied.length ? `${replied.length} to read` : withClient.length ? `${withClient.length} proposal${withClient.length === 1 ? '' : 's'}` : 'None out'}
            sub={replied[0] ? `${replied[0].projectNumber} · ${when(replied[0].lastClientReplyAt)}` : withClient[0] ? `sent ${when(withClient[0].sentToClientAt)}` : undefined}
            tone={replied.length ? 'warn' : withClient.length ? 'accent' : undefined}
          />
        )}
        <Tile
          icon={IndianRupee}
          label={money?.overdue > 0 ? 'Overdue' : 'Owed'}
          value={money ? compactMoney(money.overdue > 0 ? money.overdue : money.outstanding) : biz?.converted ? '—' : 'Not a customer yet'}
          sub={money ? (money.quoted > 0 ? `${compactMoney(money.quoted)} quoted · ${compactMoney(money.received)} received` : 'Nothing quoted') : undefined}
          tone={money?.overdue > 0 ? 'warn' : money && money.outstanding === 0 && money.received > 0 ? 'good' : undefined}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {lead.mobile && (
          <a href={`tel:${lead.mobile}`} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent">
            <Phone className="h-3.5 w-3.5" /> Call
          </a>
        )}
        {lead.email && (
          <button onClick={() => onGoToTab('email')} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent">
            <Mail className="h-3.5 w-3.5" /> Email
          </button>
        )}
        <button onClick={() => onGoToTab('followups')} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent">
          <MessageSquare className="h-3.5 w-3.5" /> Log a follow-up
        </button>
        {projectsOn && (
          <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10">
            <FolderKanban className="h-3.5 w-3.5" /> Start a project
          </button>
        )}
        {hasDeals && biz?.converted && biz.account && (
          <button onClick={() => setDealing(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/20">
            <Handshake className="h-3.5 w-3.5" /> Open a deal
          </button>
        )}
        {biz?.converted && biz.account && (
          <Link
            to="/app/accounts/$accountId"
            params={{ accountId: String(biz.account.id) }}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <Handshake className="h-3.5 w-3.5" /> Open the account
          </Link>
        )}
      </div>

      {creating && (
        <NewProjectModal
          open
          onClose={() => setCreating(false)}
          defaults={{
            leadId: Number(lead.id),
            accountId: biz?.account?.id ?? null,
            title: biz?.business?.projectTitle ?? '',
            description: biz?.business?.projectDescription ?? '',
            clientName: lead.name ?? '',
            clientEmail: lead.email ?? '',
          }}
        />
      )}
      {dealing && pipelines.length > 0 && (
        <NewDealModal
          pipelines={pipelines}
          defaults={{
            accountId: biz?.account?.id ?? null,
            accountName: biz?.account?.name ?? null,
            contactId: biz?.business?.contactId ?? null,
            name: biz?.business?.projectTitle ?? '',
          }}
          onClose={() => setDealing(false)}
          onCreated={() => {
            setDealing(false)
            onGoToTab('overview')
          }}
        />
      )}
    </div>
  )
}
