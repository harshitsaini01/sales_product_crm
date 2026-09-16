import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTasks, useCreateTask, useUpdateTask, useDeleteTask } from '@/hooks/useTasks'
import { usersApi } from '@/lib/api'
import { LeadCallingTasks, DayStrip } from '@/components/tasks/LeadCallingTasks'
import { CallingLoadTable } from '@/components/tasks/CallingLoadTable'
import { useAuthStore } from '@/stores/auth.store'
import { formatDate } from '@/lib/utils'
import {
  Loader2,
  Plus,
  CheckCircle2,
  Circle,
  Trash2,
  AlertTriangle,
  Search,
  Pencil,
  X,
  CalendarDays,
  User as UserIcon,
  Flag,
  ListTodo,
  Clock,
  CalendarCheck,
  CalendarRange,
  LayoutGrid,
  List,
  CheckSquare,
  Square,
  MoreHorizontal,
  Play,
  RotateCcw,
  Clock3,
  PhoneCall,
} from 'lucide-react'

interface Task {
  id: number
  title: string
  description?: string
  status: number
  priority: 'low' | 'medium' | 'high'
  dueDate?: string
  createdAt?: string
  assignedBy: { id: number; name: string }
  assignedTo: { id: number; name: string }
}

type StatusFilter = 'all' | 'pending' | 'overdue' | 'today' | 'week' | 'completed'
type ViewTab = 'mine' | 'created' | 'all'
type SortBy = 'due' | 'priority' | 'created' | 'title'
type LayoutMode = 'list' | 'kanban'

const PRIORITY_BADGE: Record<string, string> = {
  high: 'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

const PRIORITY_BAR: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
  low: 'bg-emerald-500',
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const

function startOfToday() {
  return new Date(new Date().toDateString())
}

function localISO(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dueDateISO(v?: string): string {
  if (!v) return ''
  const d = new Date(v)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isOverdue(dueDate?: string, status?: number) {
  if (!dueDate || status === 1) return false
  return new Date(dueDate) < startOfToday()
}

function isDueToday(dueDate?: string) {
  if (!dueDate) return false
  const d = new Date(dueDate)
  const t = startOfToday()
  return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate()
}

function isDueThisWeek(dueDate?: string) {
  if (!dueDate) return false
  const d = new Date(dueDate)
  const t = startOfToday()
  const wkEnd = new Date(t)
  wkEnd.setDate(wkEnd.getDate() + 7)
  return d >= t && d < wkEnd
}

function dueLabel(dueDate?: string, status?: number) {
  if (!dueDate) return null
  if (status === 1) return formatDate(dueDate)
  const d = new Date(dueDate)
  const t = startOfToday()
  const ms = d.getTime() - t.getTime()
  const days = Math.round(ms / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days <= 7) return `In ${days}d`
  return formatDate(dueDate)
}

function initials(name?: string) {
  if (!name) return '?'
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('')
}

export function Tasks() {
  const { isAdmin, user } = useAuthStore()
  const me = user?.id
  const admin = isAdmin()

  // Day-wise timeline is shared between the calling-tasks panel AND the personal
  // tasks list below — so an admin picking "Wed 20" sees both types of work due
  // that day at once. Empty string = "all open" (ignores date).
  const today = localISO()
  const [selectedDate, setSelectedDate] = useState<string>(today)
  const [showAdd, setShowAdd] = useState(false)
  // "Assign leads" opens the full-page builder in a NEW TAB — it carries a
  // multi-day cohort, the whole lead filter bar and a large table, which is far
  // too much for a dialog. This tab refetches on focus, so the calling-task
  // panel below refreshes as soon as the admin switches back.
  const openTaskBuilder = () => window.open(`/app/task-builder?date=${selectedDate || today}`, '_blank', 'noopener')
  const [editing, setEditing] = useState<Task | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [view, setView] = useState<ViewTab>(admin ? 'all' : 'mine')
  const [search, setSearch] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortBy>('due')
  const [layout, setLayout] = useState<LayoutMode>('list')
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const { data: tasks = [], isLoading } = useTasks() as { data: Task[]; isLoading: boolean }
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()

  const stats = useMemo(() => {
    const inView = tasks.filter((t) => {
      if (view === 'mine') return t.assignedTo?.id === me
      if (view === 'created') return t.assignedBy?.id === me
      return true
    })
    return {
      total: inView.length,
      pending: inView.filter((t) => t.status === 0).length,
      completed: inView.filter((t) => t.status === 1).length,
      overdue: inView.filter((t) => isOverdue(t.dueDate, t.status)).length,
      today: inView.filter((t) => t.status === 0 && isDueToday(t.dueDate)).length,
      week: inView.filter((t) => t.status === 0 && isDueThisWeek(t.dueDate)).length,
    }
  }, [tasks, view, me])

  const filtered = useMemo(() => {
    let list = tasks

    if (view === 'mine') list = list.filter((t) => t.assignedTo?.id === me)
    else if (view === 'created') list = list.filter((t) => t.assignedBy?.id === me)

    if (statusFilter === 'pending') list = list.filter((t) => t.status === 0)
    else if (statusFilter === 'completed') list = list.filter((t) => t.status === 1)
    else if (statusFilter === 'overdue') list = list.filter((t) => isOverdue(t.dueDate, t.status))
    else if (statusFilter === 'today')
      list = list.filter((t) => t.status === 0 && isDueToday(t.dueDate))
    else if (statusFilter === 'week')
      list = list.filter((t) => t.status === 0 && isDueThisWeek(t.dueDate))

    // Day-wise date filter (shared with the calling-tasks panel above). A task
    // shows on its dueDate; when the selected day IS today, overdue-open tasks
    // ALSO show (carry-over). Empty selectedDate = all open.
    if (selectedDate) {
      list = list.filter((t) => {
        const iso = dueDateISO(t.dueDate)
        if (iso && iso === selectedDate) return true
        if (selectedDate === today && t.status === 0 && iso && iso < today) return true
        return false
      })
    } else {
      list = list.filter((t) => t.status === 0)
    }

    if (priorityFilter !== 'all') list = list.filter((t) => t.priority === priorityFilter)

    if (assigneeFilter !== 'all')
      list = list.filter((t) => String(t.assignedTo?.id) === assigneeFilter)

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.assignedTo?.name.toLowerCase().includes(q),
      )
    }

    const sorted = [...list].sort((a, b) => {
      if (sortBy === 'due') {
        const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity
        const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity
        return da - db
      }
      if (sortBy === 'priority') return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      if (sortBy === 'title') return a.title.localeCompare(b.title)
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return cb - ca
    })

    return sorted
  }, [tasks, view, me, statusFilter, priorityFilter, assigneeFilter, search, sortBy, selectedDate, today])

  const uniqueAssignees = useMemo(() => {
    const map = new Map<number, string>()
    tasks.forEach((t) => t.assignedTo && map.set(t.assignedTo.id, t.assignedTo.name))
    return Array.from(map.entries())
  }, [tasks])

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const clearSelection = () => setSelected(new Set())

  const bulkComplete = () => {
    selected.forEach((id) => updateTask.mutate({ id, data: { status: 1 } }))
    clearSelection()
  }

  const bulkDelete = () => {
    if (!confirm(`Delete ${selected.size} task(s)?`)) return
    selected.forEach((id) => deleteTask.mutate(id))
    clearSelection()
  }

  const STAT_CARDS: Array<{
    key: StatusFilter
    label: string
    value: number
    Icon: typeof ListTodo
    color: string
  }> = [
    { key: 'all', label: 'Total', value: stats.total, Icon: ListTodo, color: 'text-slate-700' },
    { key: 'pending', label: 'Pending', value: stats.pending, Icon: Circle, color: 'text-blue-600' },
    { key: 'today', label: 'Due Today', value: stats.today, Icon: CalendarCheck, color: 'text-amber-600' },
    { key: 'overdue', label: 'Overdue', value: stats.overdue, Icon: AlertTriangle, color: 'text-red-600' },
    { key: 'week', label: 'This Week', value: stats.week, Icon: CalendarRange, color: 'text-violet-600' },
    { key: 'completed', label: 'Completed', value: stats.completed, Icon: CheckCircle2, color: 'text-emerald-600' },
  ]

  return (
    <div className="space-y-4">
      {/* Page header sits first so the actions — above all "Assign leads", which
          is the only place calling work gets created now — are the first thing
          on the page instead of being buried under the calling panel. */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Calling work and your team's to-do list in one place
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {admin && (
            <button
              onClick={openTaskBuilder}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary/90"
              title="Opens the assignment builder in a new tab — pick leads and share them between counsellors"
            >
              <PhoneCall className="h-4 w-4" /> Assign leads
            </button>
          )}
        </div>
      </div>

      {/* Shared day-wise timeline. Selecting a day filters BOTH the calling-tasks
          panel and the personal tasks list below, so a single click gives a full
          "here's what's due on this day" view. */}
      <div className="rounded-2xl border bg-card p-3 shadow-sm">
        <div className="flex items-center justify-between gap-3 px-1 pb-1">
          <div>
            <p className="text-sm font-black">Day-wise task view</p>
            <p className="text-[11px] text-muted-foreground">
              Pick any date to see the calling tasks and personal tasks due that day. Overdue open work carries over to today.
            </p>
          </div>
          {selectedDate && selectedDate !== today && (
            <button onClick={() => setSelectedDate(today)} className="text-[11px] font-bold text-primary hover:underline">
              Jump to today
            </button>
          )}
        </div>
        <DayStrip today={today} selectedDate={selectedDate} onChange={setSelectedDate} />
      </div>

      {/* Calling work assigned from the lead assignment panel below. */}
      <LeadCallingTasks selectedDate={selectedDate} onDateChange={setSelectedDate} hideDateStrip />

      {/* Day-by-day load: who got how many leads on each task date and how many
          of those calls are still pending. */}
      <CallingLoadTable selectedDate={selectedDate} />

      {/* Personal / team to-do list. Its own header sits directly on top of the
          counters and the list they filter, so the whole block reads as one
          thing: how many are open, what state they are in, and where to add. */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-4">
        <div>
          <h2 className="text-lg font-black">To-do tasks</h2>
          <p className="text-xs text-muted-foreground">
            {admin ? "Work you assign to the team — separate from calling work above." : 'Your to-dos — separate from the calling work above.'}
            {' '}Tap a counter to filter; tick a task to mark it done.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> {admin ? 'Assign task' : 'Add task'}
        </button>
      </div>

      {/* Stat cards — each one filters the list below it. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {STAT_CARDS.map(({ key, label, value, Icon, color }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`text-left bg-card border rounded-lg p-3 hover:shadow-sm transition-all ${
              statusFilter === key ? 'ring-2 ring-primary border-primary' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium">{label}</span>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
          </button>
        ))}
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-lg w-fit">
        {(
          [
            { k: 'mine', label: 'My Tasks' },
            { k: 'created', label: 'Created by Me' },
            ...(admin ? [{ k: 'all' as const, label: 'All Tasks' }] : []),
          ] as Array<{ k: ViewTab; label: string }>
        ).map(({ k, label }) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
              view === k ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Toolbar: search + filters + sort + layout */}
      <div className="flex items-center gap-2 flex-wrap bg-card border rounded-lg p-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, description, or assignee..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as 'all' | 'high' | 'medium' | 'low')}
          className="px-2 py-1.5 text-sm border rounded-md bg-background"
        >
          <option value="all">All priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        {admin && view !== 'mine' && (
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="px-2 py-1.5 text-sm border rounded-md bg-background"
          >
            <option value="all">All assignees</option>
            {uniqueAssignees.map(([id, name]) => (
              <option key={id} value={String(id)}>
                {name}
              </option>
            ))}
          </select>
        )}

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          className="px-2 py-1.5 text-sm border rounded-md bg-background"
        >
          <option value="due">
            Sort: Due date
          </option>
          <option value="priority">Sort: Priority</option>
          <option value="created">Sort: Newest</option>
          <option value="title">Sort: Title</option>
        </select>

        <div className="flex items-center gap-1 border rounded-md p-0.5">
          <button
            onClick={() => setLayout('list')}
            className={`p-1.5 rounded ${layout === 'list' ? 'bg-muted' : ''}`}
            title="List view"
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setLayout('kanban')}
            className={`p-1.5 rounded ${layout === 'kanban' ? 'bg-muted' : ''}`}
            title="Kanban view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
        </div>

        {(search || priorityFilter !== 'all' || assigneeFilter !== 'all' || statusFilter !== 'pending') && (
          <button
            onClick={() => {
              setSearch('')
              setPriorityFilter('all')
              setAssigneeFilter('all')
              setStatusFilter('pending')
            }}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 bg-primary/5 border border-primary/30 rounded-lg p-2 px-3">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <button
            onClick={bulkComplete}
            className="text-xs px-2 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 flex items-center gap-1"
          >
            <CheckCircle2 className="h-3 w-3" /> Mark complete
          </button>
          {admin && (
            <button
              onClick={bulkDelete}
              className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-1"
            >
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          )}
          <button onClick={clearSelection} className="text-xs ml-auto text-muted-foreground">
            Clear
          </button>
        </div>
      )}

      {/* Body */}
      {isLoading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-card border rounded-lg">
          <ListTodo className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No tasks match the current filters.</p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-3 text-sm text-primary hover:underline"
          >
            + {admin ? 'Assign a task' : 'Add a task'}
          </button>
        </div>
      ) : layout === 'kanban' ? (
        <KanbanBoard
          tasks={filtered}
          me={me}
          admin={admin}
          onToggle={(id, status) => updateTask.mutate({ id, data: { status } })}
          onEdit={setEditing}
          onDelete={(id) => deleteTask.mutate(id)}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              me={me}
              admin={admin}
              selected={selected.has(t.id)}
              onSelect={() => toggleSelect(t.id)}
              onToggle={(id, status) => updateTask.mutate({ id, data: { status } })}
              onSnooze={(id, iso) => updateTask.mutate({ id, data: { dueDate: iso } })}
              onEdit={() => setEditing(t)}
              onDelete={() => {
                if (confirm(`Delete task "${t.title}"?`)) deleteTask.mutate(t.id)
              }}
            />
          ))}
        </div>
      )}

      {showAdd && <TaskFormModal onClose={() => setShowAdd(false)} />}
      {editing && <TaskFormModal task={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function TaskCard({
  task,
  me,
  admin,
  selected,
  onSelect,
  onToggle,
  onSnooze,
  onEdit,
  onDelete,
}: {
  task: Task
  me?: number
  admin: boolean
  selected: boolean
  onSelect: () => void
  onToggle: (id: number, status: number) => void
  onSnooze: (id: number, iso: string) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const overdue = isOverdue(task.dueDate, task.status)
  const isCreator = task.assignedBy?.id === me
  const canEdit = admin || isCreator
  const canDelete = admin || isCreator
  const [menuOpen, setMenuOpen] = useState(false)

  const snoozeBy = (days: number) => {
    const base = task.dueDate ? new Date(task.dueDate) : new Date()
    base.setDate(base.getDate() + days)
    const iso = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`
    onSnooze(task.id, iso)
    setMenuOpen(false)
  }

  return (
    <div
      className={`relative flex items-start gap-3 p-3 pl-4 bg-card border rounded-lg group hover:shadow-sm transition-shadow ${
        overdue ? 'border-red-200' : ''
      } ${task.status === 1 ? 'border-emerald-300 bg-emerald-50' : ''} ${selected ? 'ring-2 ring-primary' : ''}`}
    >
      <span
        className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${
          PRIORITY_BAR[task.priority] || PRIORITY_BAR.medium
        }`}
      />
      <button onClick={onSelect} className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground">
        {selected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
      </button>
      <button
        onClick={() => onToggle(task.id, task.status === 0 ? 1 : 0)}
        className="mt-0.5 shrink-0"
        title={task.status === 1 ? 'Mark pending' : 'Mark complete'}
      >
        {task.status === 1 ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
        ) : (
          <Circle className="h-5 w-5 text-muted-foreground hover:text-emerald-500" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p
            className={`text-sm font-semibold ${
              task.status === 1 ? 'line-through text-muted-foreground' : ''
            }`}
          >
            {task.title}
          </p>
          <span
            className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${
              PRIORITY_BADGE[task.priority] || PRIORITY_BADGE.medium
            }`}
          >
            <Flag className="h-2.5 w-2.5 inline mr-0.5" />
            {task.priority}
          </span>
          {overdue && (
            <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 flex items-center gap-1">
              <AlertTriangle className="h-2.5 w-2.5" />
              Overdue
            </span>
          )}
          {task.status === 1 && (
            <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
              Done
            </span>
          )}
        </div>
        {task.description && (
          <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-2">
            {task.description}
          </p>
        )}
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
          {task.dueDate && (
            <span
              className={`flex items-center gap-1 ${
                overdue ? 'text-red-600 font-semibold' : ''
              }`}
            >
              <CalendarDays className="h-3 w-3" />
              {dueLabel(task.dueDate, task.status)}
            </span>
          )}
          {task.assignedTo && (
            <span className="flex items-center gap-1">
              <span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">
                {initials(task.assignedTo.name)}
              </span>
              {task.assignedTo.name}
              {task.assignedTo.id === me && (
                <span className="text-[9px] uppercase bg-primary/10 text-primary px-1 rounded">You</span>
              )}
            </span>
          )}
          {task.assignedBy && (
            <span className="flex items-center gap-1 text-muted-foreground/70">
              <UserIcon className="h-3 w-3" />
              by {task.assignedBy.name}
            </span>
          )}
          {task.createdAt && (
            <span className="flex items-center gap-1 text-muted-foreground/70">
              <Clock className="h-3 w-3" />
              {formatDate(task.createdAt)}
            </span>
          )}
        </div>
      </div>
      {/* Advanced actions menu — replaces the previous hover-only edit/delete icons.
          One button, one menu, covers Complete / Reopen / Snooze +1d / +3d /
          next week / Edit / Delete. Menu is anchored to the button and closes
          on any action. Keeps the row header uncluttered. */}
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded-md border border-border/60 bg-background p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Actions"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-8 z-50 w-44 rounded-lg border bg-popover text-popover-foreground shadow-lg py-1 text-xs">
              {task.status === 0 ? (
                <MenuItem icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />} label="Mark complete" onClick={() => { onToggle(task.id, 1); setMenuOpen(false) }} />
              ) : (
                <MenuItem icon={<RotateCcw className="h-3.5 w-3.5 text-blue-600" />} label="Reopen task" onClick={() => { onToggle(task.id, 0); setMenuOpen(false) }} />
              )}
              {task.status === 0 && (
                <MenuItem icon={<Play className="h-3.5 w-3.5 text-primary" />} label="Mark in progress" onClick={() => { onToggle(task.id, 0); setMenuOpen(false) }} disabled />
              )}
              <div className="my-1 border-t" />
              <MenuItem icon={<Clock3 className="h-3.5 w-3.5 text-amber-600" />} label="Snooze · +1 day" onClick={() => snoozeBy(1)} />
              <MenuItem icon={<Clock3 className="h-3.5 w-3.5 text-amber-600" />} label="Snooze · +3 days" onClick={() => snoozeBy(3)} />
              <MenuItem icon={<Clock3 className="h-3.5 w-3.5 text-amber-600" />} label="Snooze · next week" onClick={() => snoozeBy(7)} />
              <div className="my-1 border-t" />
              {canEdit && <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} label="Edit task" onClick={() => { onEdit(); setMenuOpen(false) }} />}
              {canDelete && (
                <MenuItem icon={<Trash2 className="h-3.5 w-3.5 text-red-600" />} label="Delete task" tone="text-red-600" onClick={() => { onDelete(); setMenuOpen(false) }} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function MenuItem({ icon, label, onClick, tone, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; tone?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed ${tone || ''}`}
    >
      {icon}
      <span className="font-semibold">{label}</span>
      {disabled && <span className="ml-auto text-[9px] uppercase text-muted-foreground">soon</span>}
    </button>
  )
}

function KanbanBoard({
  tasks,
  me,
  admin,
  onToggle,
  onEdit,
  onDelete,
}: {
  tasks: Task[]
  me?: number
  admin: boolean
  onToggle: (id: number, status: number) => void
  onEdit: (t: Task) => void
  onDelete: (id: number) => void
}) {
  const columns = [
    { key: 'overdue', label: 'Overdue', filter: (t: Task) => isOverdue(t.dueDate, t.status), color: 'text-red-600' },
    { key: 'pending', label: 'Pending', filter: (t: Task) => t.status === 0 && !isOverdue(t.dueDate, t.status), color: 'text-blue-600' },
    { key: 'completed', label: 'Completed', filter: (t: Task) => t.status === 1, color: 'text-emerald-600' },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {columns.map((col) => {
        const colTasks = tasks.filter(col.filter)
        return (
          <div key={col.key} className="bg-muted/30 rounded-lg p-3">
            <div className={`flex items-center justify-between mb-3 ${col.color}`}>
              <span className="text-sm font-bold uppercase">{col.label}</span>
              <span className="text-xs bg-card border rounded-full px-2 py-0.5">{colTasks.length}</span>
            </div>
            <div className="space-y-2">
              {colTasks.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">Empty</p>
              ) : (
                colTasks.map((t) => {
                  const overdue = isOverdue(t.dueDate, t.status)
                  const isCreator = t.assignedBy?.id === me
                  const canEdit = admin || isCreator
                  return (
                    <div
                      key={t.id}
                      className={`bg-card border rounded-md p-2.5 group hover:shadow-sm relative ${
                        t.status === 1 ? 'opacity-70' : ''
                      }`}
                    >
                      <span
                        className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-md ${
                          PRIORITY_BAR[t.priority] || PRIORITY_BAR.medium
                        }`}
                      />
                      <div className="flex items-start gap-2 ml-1">
                        <button onClick={() => onToggle(t.id, t.status === 0 ? 1 : 0)} className="mt-0.5">
                          {t.status === 1 ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <Circle className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm font-medium truncate ${
                              t.status === 1 ? 'line-through' : ''
                            }`}
                          >
                            {t.title}
                          </p>
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            <span
                              className={`text-[9px] uppercase font-bold px-1 rounded border ${
                                PRIORITY_BADGE[t.priority]
                              }`}
                            >
                              {t.priority}
                            </span>
                            {t.dueDate && (
                              <span
                                className={`text-[10px] ${
                                  overdue ? 'text-red-600 font-semibold' : 'text-muted-foreground'
                                }`}
                              >
                                {dueLabel(t.dueDate, t.status)}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                            <span className="h-4 w-4 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-[8px]">
                              {initials(t.assignedTo?.name)}
                            </span>
                            {t.assignedTo?.name}
                          </div>
                        </div>
                        {canEdit && (
                          <div className="opacity-0 group-hover:opacity-100 flex flex-col gap-0.5">
                            <button onClick={() => onEdit(t)} className="p-1 hover:bg-muted rounded">
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Delete "${t.title}"?`)) onDelete(t.id)
                              }}
                              className="p-1 hover:bg-red-50 text-destructive rounded"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TaskFormModal({ task, onClose }: { task?: Task; onClose: () => void }) {
  const { isAdmin, user } = useAuthStore()
  const admin = isAdmin()
  const editing = !!task

  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    assignedToId: task?.assignedTo?.id ? String(task.assignedTo.id) : admin ? '' : String(user?.id || ''),
    dueDate: task?.dueDate ? task.dueDate.slice(0, 10) : '',
    priority: (task?.priority || 'medium') as 'low' | 'medium' | 'high',
    status: task?.status ?? 0,
  })

  const { data: users = [] } = useQuery<{ id: number; name: string; role: string }[]>({
    queryKey: ['users', 'all-staff'],
    queryFn: () => usersApi.list(),
    enabled: admin,
  })

  const create = useCreateTask()
  const update = useUpdateTask()

  const submit = () => {
    if (!form.title.trim()) return
    if (editing && task) {
      update.mutate(
        {
          id: task.id,
          data: {
            title: form.title,
            description: form.description || undefined,
            assignedToId: admin ? Number(form.assignedToId) : undefined,
            dueDate: form.dueDate || null,
            priority: form.priority,
            status: form.status,
          },
        },
        { onSuccess: onClose },
      )
    } else {
      create.mutate(
        {
          title: form.title,
          description: form.description || undefined,
          assignedToId: admin ? Number(form.assignedToId) : Number(user?.id),
          dueDate: form.dueDate || undefined,
          priority: form.priority,
        },
        { onSuccess: onClose },
      )
    }
  }

  const pending = create.isPending || update.isPending

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-card">
          <h2 className="font-semibold">{editing ? 'Edit Task' : admin ? 'Assign Task' : 'Add Task'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Title *</label>
            <input
              autoFocus
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="What needs to be done?"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              rows={4}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Add more detail (optional)"
            />
          </div>

          {admin ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Assign To *</label>
              <select
                value={form.assignedToId}
                onChange={(e) => setForm((p) => ({ ...p, assignedToId: e.target.value }))}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select staff member</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-2">
              <UserIcon className="h-3 w-3 inline mr-1" />
              This task will be assigned to <strong>you</strong>.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Due Date</label>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value as 'low' | 'medium' | 'high' }))}
                className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background"
              >
                {(['high', 'medium', 'low'] as const).map((p) => (
                  <option key={p} value={p}>
                    {p[0].toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick due-date chips */}
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1">Quick:</span>
            {[
              { label: 'Today', days: 0 },
              { label: 'Tomorrow', days: 1 },
              { label: 'In 3 days', days: 3 },
              { label: 'Next week', days: 7 },
            ].map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => {
                  const d = new Date()
                  d.setDate(d.getDate() + q.days)
                  setForm((p) => ({ ...p, dueDate: d.toISOString().slice(0, 10) }))
                }}
                className="text-[11px] px-2 py-0.5 border rounded hover:bg-muted"
              >
                {q.label}
              </button>
            ))}
          </div>

          {editing && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => setForm((p) => ({ ...p, status: 0 }))}
                  className={`flex-1 text-sm py-2 rounded-md border ${
                    form.status === 0 ? 'bg-blue-50 border-blue-300 text-blue-700' : ''
                  }`}
                >
                  <Circle className="h-3.5 w-3.5 inline mr-1" /> Pending
                </button>
                <button
                  onClick={() => setForm((p) => ({ ...p, status: 1 }))}
                  className={`flex-1 text-sm py-2 rounded-md border ${
                    form.status === 1 ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : ''
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 inline mr-1" /> Completed
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end p-4 border-t sticky bottom-0 bg-card">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-md hover:bg-muted">
            Cancel
          </button>
          <button
            disabled={pending || !form.title.trim() || (admin && !editing && !form.assignedToId)}
            onClick={submit}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md disabled:opacity-50 flex items-center gap-2"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editing ? 'Save Changes' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  )
}
