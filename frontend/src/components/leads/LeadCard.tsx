import { Link } from '@tanstack/react-router'
import {
  User, MessageSquare, CalendarCheck, Globe, Clock, Flag, Pencil,
  ExternalLink, CheckCircle2, AlertCircle, PhoneCall, TrendingUp,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth.store'
import { useLeadFields } from '@/hooks/useLeadFields'
import { formatDate, maskPhone, isNoFollowupDate } from '@/lib/utils'

// ─── Design tokens ────────────────────────────────────────────────────────────
export function getStatusConfig(status: string) {
  const s = (status || '').toLowerCase()
  if (s.includes('hot') || s.includes('interest') || s.includes('confirm') || s.includes('enrolled'))
    return { bg: 'bg-emerald-500', light: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', border: 'border-l-emerald-500' }
  if (s.includes('warm') || s.includes('follow') || s.includes('callback'))
    return { bg: 'bg-orange-500', light: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500', border: 'border-l-orange-500' }
  if (s.includes('cold') || s.includes('dead') || s.includes('lost') || s.includes('not'))
    return { bg: 'bg-slate-400', light: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400', border: 'border-l-slate-400' }
  if (s.includes('fresh') || s.includes('new'))
    return { bg: 'bg-blue-500', light: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500', border: 'border-l-blue-500' }
  return { bg: 'bg-violet-500', light: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500', border: 'border-l-violet-500' }
}

const WEBSITE_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  MYS: { bg: 'bg-sky-500', text: 'text-white', label: 'Malaysia' },
  IND: { bg: 'bg-orange-500', text: 'text-white', label: 'India' },
  BRI: { bg: 'bg-violet-500', text: 'text-white', label: 'Britain' },
  CAN: { bg: 'bg-red-500', text: 'text-white', label: 'Canada' },
  DEU: { bg: 'bg-yellow-500', text: 'text-black', label: 'Germany' },
  USA: { bg: 'bg-blue-600', text: 'text-white', label: 'USA' },
  tutelagestudy: { bg: 'bg-emerald-600', text: 'text-white', label: 'Tutelage Study' },
  mymbbsadmission: { bg: 'bg-rose-600', text: 'text-white', label: 'My MBBS Admission' },
  mbbsinmalaysia: { bg: 'bg-sky-600', text: 'text-white', label: 'MBBS in Malaysia' },
  mbbsinvietnam: { bg: 'bg-teal-600', text: 'text-white', label: 'MBBS in Vietnam' },
  mbbsinkazak: { bg: 'bg-amber-600', text: 'text-white', label: 'MBBS in Kazak' },
  mbbskyrgyzstan: { bg: 'bg-orange-600', text: 'text-white', label: 'MBBS Kyrgyzstan' },
  whatsapp: { bg: 'bg-green-600', text: 'text-white', label: 'WhatsApp' },
  facebook: { bg: 'bg-blue-700', text: 'text-white', label: 'Facebook' },
  instagram: { bg: 'bg-pink-600', text: 'text-white', label: 'Instagram' },
  google: { bg: 'bg-blue-500', text: 'text-white', label: 'Google' },
  referral: { bg: 'bg-purple-600', text: 'text-white', label: 'Referral' },
  walkin: { bg: 'bg-stone-600', text: 'text-white', label: 'Walk-in' },
  manual: { bg: 'bg-slate-500', text: 'text-white', label: 'Manual' },
  other: { bg: 'bg-slate-400', text: 'text-white', label: 'Other' },
}

export function getWebsiteConfig(website: string | null | undefined): { bg: string; text: string; label: string } {
  if (!website) return { bg: 'bg-slate-300', text: 'text-slate-700', label: 'Unknown' }
  const key = String(website).trim()
  if (WEBSITE_CONFIG[key]) return WEBSITE_CONFIG[key]
  if (WEBSITE_CONFIG[key.toUpperCase()]) return WEBSITE_CONFIG[key.toUpperCase()]
  const lower = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (WEBSITE_CONFIG[lower]) return WEBSITE_CONFIG[lower]
  return { bg: 'bg-zinc-500', text: 'text-white', label: key }
}

const COMPLETION_FIELDS = [
  'name', 'email', 'mobile', 'father', 'city', 'state',
  'gender', 'dob', 'neetQualified', 'intrestedCourse',
  'approximateBudget', 'highestQualification',
] as const

/**
 * How complete is this lead?
 *
 * Only counts fields the customer actually has. Scoring a lead against twelve
 * fields when four of them are switched off would cap every lead at 67% and
 * make the number meaningless.
 *
 * `isVisible` is optional so the existing non-hook callers keep working.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function profileCompletion(lead: any, isVisible?: (key: string) => boolean) {
  const keys = isVisible ? COMPLETION_FIELDS.filter((k) => isVisible(k)) : COMPLETION_FIELDS
  if (!keys.length) return 100
  const filled = keys.filter((k) => lead[k] && String(lead[k]).trim()).length
  return Math.round((filled / keys.length) * 100)
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEAD CARD — Premium CRM-grade design
// ═══════════════════════════════════════════════════════════════════════════════

export interface LeadCardProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lead: any
  index: number
  isSelected?: boolean
  onSelect?: () => void
  onToggleWapp?: () => void
  onQuickEdit?: () => void
  onUpdateStatus?: () => void
  // Optional slot for additional action buttons (e.g. "Unassign") appended
  // to the right side of the top action row.
  extraActions?: React.ReactNode
}

export function LeadCard({
  lead, index, isSelected = false, onSelect, onToggleWapp, onQuickEdit, onUpdateStatus, extraActions,
}: LeadCardProps) {
  const reveal = useAuthStore((s) => s.canRevealPhone())
  const statusCfg = getStatusConfig(lead.leadStatus || 'Fresh')
  const lastFollowup = lead.followups?.[0]
  const lastChatComment = lead.comments?.[0]
  // Pick the truly latest comment between followup-comments and the chat-style
  // leadComment thread. Both rows have a createdAt; whichever is newer wins.
  const lastAnyComment = (() => {
    const a = lastFollowup ? { ...lastFollowup, source: 'followup' as const } : null
    const b = lastChatComment ? { ...lastChatComment, source: 'comment' as const } : null
    if (a && b) return new Date(a.createdAt) >= new Date(b.createdAt) ? a : b
    return a || b
  })()
  const isNAFollowup = isNoFollowupDate(lead.followupDate)
  const isOverdue = lead.followupDate && !isNAFollowup && new Date(lead.followupDate) < new Date()
  const wbCfg = getWebsiteConfig(lead.website)
  // When the website is the generic "other" bucket, prefer the specific source
  // name (e.g. "harshit", "facebook campaign", "whatsapp chat") so the badge
  // carries real signal instead of just saying "Other".
  const isGenericSource =
    !lead.website || /^other$/i.test(String(lead.website).trim()) || wbCfg.label === 'Other'
  const sourceDisplay =
    isGenericSource && lead.source && String(lead.source).trim()
      ? String(lead.source).trim()
      : wbCfg.label
  const { visible, label } = useLeadFields()
  // Scoring against fields the customer cannot see caps every lead below 100%
  // forever — a B2B lead was stuck at 50% because half the twelve were NEET,
  // father, gender and qualification.
  const pct = profileCompletion(lead, visible)

  return (
    <div className={`
      relative rounded-xl border-l-[3px] border overflow-hidden
      transition-colors
      ${statusCfg.border}
      ${isSelected
        ? 'border-primary/40 bg-primary/[0.02]'
        : 'border-border bg-card'
      }
    `}>

      {/* ════ SECTION A: Top bar ════ */}
      <div className={`flex items-center gap-2 px-4 py-2.5 flex-wrap ${isSelected ? 'bg-primary/[0.04]' : 'bg-muted/20'} border-b border-border/50`}>

        {/* Checkbox + index */}
        {onSelect ? (
          <label className="flex items-center gap-2 cursor-pointer shrink-0">
            <input type="checkbox" checked={isSelected} onChange={onSelect}
              className="h-4 w-4 rounded border-border accent-primary cursor-pointer" />
            <span className="text-xs font-mono text-muted-foreground font-semibold">{index}.</span>
          </label>
        ) : (
          <span className="text-xs font-mono text-muted-foreground font-semibold shrink-0">{index}.</span>
        )}

        {/* ID */}
        <span className="px-2 py-1 text-xs font-mono font-bold bg-background border border-border rounded-md text-foreground">
          # {lead.id}
        </span>

        {/* Profile % pill */}
        <div className={`flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${
          pct >= 80 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
          pct >= 50 ? 'bg-amber-50 text-amber-700 border-amber-200' :
          'bg-red-50 text-red-600 border-red-200'
        }`}>
          {pct}%
        </div>

        {/* Engagement icons */}
        {lead.called === 1 && <div title="Called" className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200"><PhoneCall className="h-3 w-3" /></div>}
        {lead.wapp === 1 && <div title="WhatsApp sent" className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200"><MessageSquare className="h-3 w-3" /></div>}
        {(lead.flagSend === 1 || lead.flagRcv === 1) && (
          <span title="Flagged" className="flex items-center gap-1 px-2 py-0.5 text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-full">
            <Flag className="h-3 w-3" /> Flagged
          </span>
        )}

        {/* Status badge */}
        <span className={`px-3 py-1 rounded-full border text-xs font-bold ${statusCfg.light}`}>
          <span className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${statusCfg.dot} inline-block`} />
            {lead.leadStatus || 'Fresh'}
            {lead.leadSubStatus && <span className="opacity-60">· {lead.leadSubStatus}</span>}
          </span>
        </span>

        {/* Event */}
        {lead.event && (
          <span className="px-2.5 py-0.5 text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full">
            {lead.event}
          </span>
        )}

        {/* Source / Website — always visible */}
        <span
          className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${wbCfg.bg} ${wbCfg.text} flex items-center gap-1`}
          title={
            isGenericSource && lead.source
              ? `Source: ${lead.source} (${wbCfg.label})`
              : `Source: ${wbCfg.label}`
          }
        >
          <Globe className="h-3 w-3 opacity-80" />
          {sourceDisplay}
        </span>

        {/* Duplicate badge — repeat submission from website */}
        {lead.isDuplicate && (
          <Link
            to="/app/leads/$leadId"
            params={{ leadId: String(lead.duplicateOfId ?? lead.id) }}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={lead.duplicateOfId ? `Duplicate of lead #${lead.duplicateOfId} — click to view original` : 'Duplicate submission'}
            className="px-2.5 py-0.5 text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 rounded-full hover:bg-amber-200 transition-colors"
          >
            ⚠ Duplicate{lead.duplicateOfId ? ` of #${lead.duplicateOfId}` : ''}
          </Link>
        )}

        {/* Assigned sales reps — show ALL active assignees */}
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {(lead.assignedTo ?? []).map((a: any, i: number) => a.counsellor?.name ? (
          <span key={i} className="flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold bg-cyan-50 text-cyan-700 border border-cyan-200 rounded-full">
            <User className="h-3 w-3" /> {a.counsellor.name}
          </span>
        ) : null)}

        <div className="flex-1" />

        {/* Quick actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {onToggleWapp && (
            <button onClick={onToggleWapp} title="Send WhatsApp Message"
              className={`flex items-center justify-center p-1.5 rounded-lg border transition-all ${lead.wapp ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-background text-emerald-600 border-border hover:bg-emerald-50 hover:border-emerald-300'}`}>
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                <path d="M20.52 3.48A11.94 11.94 0 0 0 12.02 0C5.4 0 .02 5.38.02 12c0 2.11.55 4.17 1.6 5.98L0 24l6.18-1.62a11.96 11.96 0 0 0 5.84 1.49h.01c6.62 0 12-5.38 12-12 0-3.2-1.25-6.21-3.51-8.39ZM12.03 21.5h-.01a9.5 9.5 0 0 1-4.84-1.33l-.35-.21-3.67.96.98-3.58-.23-.37A9.5 9.5 0 1 1 21.52 12c0 5.24-4.26 9.5-9.49 9.5Zm5.46-7.11c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49 0 1.47 1.07 2.89 1.22 3.09.15.2 2.1 3.2 5.08 4.49.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35Z"/>
              </svg>
            </button>
          )}
          {onQuickEdit && (
            <button onClick={onQuickEdit} title="Quick edit lead details"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border bg-background text-muted-foreground border-border hover:text-primary hover:border-primary transition-all">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          )}
          {onUpdateStatus && (
            <button onClick={onUpdateStatus}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border bg-background text-muted-foreground border-border hover:text-amber-600 hover:border-amber-400 transition-all">
              <CalendarCheck className="h-3.5 w-3.5" /> Status
            </button>
          )}
          <Link to="/app/leads/$leadId" params={{ leadId: String(lead.id) }}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border bg-background text-muted-foreground border-border hover:text-primary hover:border-primary transition-all">
            <ExternalLink className="h-3.5 w-3.5" /> View
          </Link>
          {extraActions}
        </div>

        {/* Lead score — +1 for every picked-up call. Distinct chip from the
            profile-completion % on the left; a raw number, no cap. */}
        <LeadScoreChip score={Number(lead.leadScore ?? 0)} />

        {/* Timestamps — lead created (website) + when it was assigned */}
        <div className="flex flex-col items-end gap-0.5 shrink-0 whitespace-nowrap">
          <time className="text-xs text-muted-foreground flex items-center gap-1" title="Lead came in on">
            <Clock className="h-3 w-3" />
            {new Date(lead.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </time>
          {(() => {
            const assignedAt = (lead.assignedTo ?? [])[0]?.createdAt
            if (!assignedAt) return null
            return (
              <time className="text-[11px] text-cyan-700 flex items-center gap-1" title="Lead assigned on">
                <User className="h-3 w-3" />
                Assigned: {new Date(assignedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </time>
            )
          })()}
        </div>
      </div>

      {/* ════ SECTION B: Compact label:value grid ════ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-3 px-5 py-4 text-base">
        <InfoCell label="Name">
          <Link to="/app/leads/$leadId" params={{ leadId: String(lead.id) }}
            target="_blank" rel="noopener noreferrer"
            className="font-bold hover:text-primary transition-colors truncate block">
            {lead.name}
          </Link>
        </InfoCell>
        {lead.business?.companyName && (
          <InfoCell label="Company">
            <span className="font-semibold truncate block" title={lead.business.companyName}>
              {lead.business.companyName}
            </span>
          </InfoCell>
        )}
        <InfoCell label="Mobile">
          {lead.mobile ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <a href={`tel:${lead.mobile}`} className="font-semibold text-sky-600 hover:underline truncate">
                {maskPhone(lead.mobile, reveal)}
              </a>
              {lead.mobileDup && <DupTag title="Same number on another lead" />}
            </div>
          ) : <EmptyCell />}
        </InfoCell>
        {visible('email') && (
        <InfoCell label={label('email', 'Email')}>
          {lead.email ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <a href={`mailto:${lead.email}`} className="text-muted-foreground hover:text-primary transition-colors truncate">
                {lead.email}
              </a>
              {lead.emailDup && <DupTag title="Same email on another lead" />}
            </div>
          ) : <EmptyCell />}
        </InfoCell>
        )}
        {lead.business?.projectTitle && (
          <InfoCell label="Project">
            <span className="truncate block font-medium" title={lead.business.projectTitle}>
              {lead.business.projectTitle}
            </span>
          </InfoCell>
        )}
        {visible('intrestedCourse') && (
          <InfoCell label={label('intrestedCourse', 'Course')}>
            {lead.intrestedCourse ? (
              <span className="font-semibold truncate block">{lead.intrestedCourse}</span>
            ) : <EmptyCell />}
          </InfoCell>
        )}
        {visible('city') && (
          <InfoCell label={label('city', 'City')}>
            {lead.city ? <span className="truncate block">{lead.city}</span> : <EmptyCell />}
          </InfoCell>
        )}
        {visible('state') && (
          <InfoCell label={label('state', 'State')}>
            {lead.state ? <span className="truncate block">{lead.state}</span> : <EmptyCell />}
          </InfoCell>
        )}
        <InfoCell label="Notes">
          {(() => {
            const firstNote = Array.isArray(lead.notes) && lead.notes[0]?.note
              ? lead.notes[0].note
              : (typeof lead.notes === 'string' ? lead.notes : null)
            const firstComment = Array.isArray(lead.comments) && lead.comments[0]?.comment
              ? lead.comments[0].comment
              : null
            const intakeComment = lead.comment
            const noteToDisplay = firstNote || firstComment || intakeComment
            return noteToDisplay ? (
              <span className="truncate block" title={noteToDisplay}>{noteToDisplay}</span>
            ) : <EmptyCell />
          })()}
        </InfoCell>
      </div>

      {/* ════ SECTION C: Comment | Follow-up (compact single-line) ════ */}
      <div className="grid grid-cols-1 md:grid-cols-2 border-t border-border/60">

        {/* Last Comment — most recent followup */}
        <div className="px-5 py-2.5 border-b md:border-b-0 md:border-r border-border/50">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 shrink-0">
              <MessageSquare className="h-3.5 w-3.5" /> Last Comment
            </span>
            {lastAnyComment ? (
              <div className="flex items-center gap-1.5 min-w-0 text-xs">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {lastAnyComment.source === 'followup' && (lastAnyComment as any).fStatus && (
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-primary/10 text-primary rounded shrink-0">{(lastAnyComment as any).fStatus}</span>
                )}
                {lastAnyComment.user?.name && (
                  <span className="font-bold text-rose-500 shrink-0">{lastAnyComment.user.name}</span>
                )}
                <span className="text-muted-foreground shrink-0">· {formatDate(lastAnyComment.createdAt)}</span>
                <span className="text-foreground truncate">· {lastAnyComment.comment}</span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground/40 italic">No comments yet</span>
            )}
          </div>
        </div>

        {/* Next Follow-up */}
        <div className="px-5 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 shrink-0">
              <CalendarCheck className="h-3.5 w-3.5" /> Next Follow-up
            </span>
            {lead.followupDate ? (
              <div className="flex items-center gap-1.5 min-w-0 text-xs">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold border ${
                  isNAFollowup
                    ? 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800/40 dark:border-slate-700'
                    : isOverdue
                      ? 'bg-red-50 text-red-600 border-red-200 dark:bg-red-900/20 dark:border-red-800'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800'
                }`}>
                  {isNAFollowup ? <AlertCircle className="h-3 w-3" /> : isOverdue ? <AlertCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                  {formatDate(lead.followupDate)}
                  {isOverdue && <span className="opacity-70 font-normal">(Overdue)</span>}
                  {isNAFollowup && <span className="opacity-70 font-normal">(No follow-up)</span>}
                </span>
                {lastFollowup?.user?.name && (
                  <span className="font-semibold text-primary flex items-center gap-1 truncate">
                    <User className="h-3 w-3 shrink-0" /> {lastFollowup.user.name}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 min-w-0 text-xs">
                <span className="text-muted-foreground/40 italic">Not scheduled</span>
                {lastFollowup?.user?.name && (
                  <span className="font-semibold text-primary flex items-center gap-1 truncate">
                    <User className="h-3 w-3 shrink-0" /> {lastFollowup.user.name}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

function EmptyCell() {
  return <span className="text-sm text-muted-foreground/25 select-none">—</span>
}

export function DupTag({ title }: { title?: string }) {
  return (
    <span
      title={title || 'Duplicate value'}
      className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-yellow-100 text-yellow-800 border border-yellow-300"
    >
      Dup
    </span>
  )
}

function LeadScoreChip({ score }: { score: number }) {
  const tone =
    score >= 30 ? 'bg-red-50 text-red-700 border-red-200'
    : score >= 15 ? 'bg-orange-50 text-orange-700 border-orange-200'
    : score >= 5 ? 'bg-blue-50 text-blue-700 border-blue-200'
    : 'bg-slate-50 text-slate-600 border-slate-200'
  return (
    <div
      title={`Lead Score: ${score} — +1 per picked-up call`}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border shrink-0 ${tone}`}
    >
      <TrendingUp className="h-3 w-3" />
      <span className="opacity-70 font-semibold">Score</span>
      <span>{score}</span>
    </div>
  )
}

function InfoCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <div className="text-[15px] font-medium leading-snug">{children}</div>
    </div>
  )
}
