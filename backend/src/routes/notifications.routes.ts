import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { REAL_FOLLOWUP_MIN } from '../utils/date-range'
import { hasFeature } from '../lib/tenant-context'
import { waitingOn } from '../services/crm/projects.service'

export const notificationsRoutes = new Hono()

notificationsRoutes.use('*', authenticate)

// GET /api/notifications — aggregated feed for the calling user.
// Combines: today's reminders, overdue follow-ups, pending tasks (assigned to user),
// unseen chat messages count, recent flag messages.
//
// Each entry has: { type, id, title, summary, at, leadId?, link? }
//
// Cheap polling endpoint — designed to be called every ~60s by the Header bell.
notificationsRoutes.get('/', async (c) => {
  const { userId, role } = c.get('user')
  const isAdmin = ['admin', 'sub-admin'].includes(role)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  // Pending follow-ups = anything due today OR overdue (everything that needs action by EoD).
  // Counsellor scope mirrors /api/followups/today — only ACTIVE assignments (status: 1).
  const followupWhere = {
    followupDate: { gte: REAL_FOLLOWUP_MIN, lt: tomorrow },
    trash: 0,
    ...(isAdmin ? {} : { assignedTo: { some: { clrId: BigInt(userId), status: 1 } } }),
  } as const

  const reminderWhere = {
    reminderDate: { gte: today, lt: tomorrow },
    status: 0,
    ...(isAdmin ? {} : { userId: BigInt(userId) }),
  } as const

  const taskWhere = {
    status: 0,
    ...(isAdmin
      ? {}
      : {
          OR: [
            { assignedToId: BigInt(userId) },
            { assignedById: BigInt(userId) },
          ],
        }),
  } as const

  const [
    reminders, remindersTotal,
    pendingFollowups, followupsTotal,
    pendingTasks, tasksTotal,
    unseenChat, flagMessages,
  ] = await Promise.all([
    prisma.reminder.findMany({
      where: reminderWhere,
      include: { lead: { select: { id: true, name: true } } },
      take: 50,
      orderBy: { reminderDate: 'asc' },
    }),
    prisma.reminder.count({ where: reminderWhere }),
    prisma.lead.findMany({
      where: followupWhere,
      select: { id: true, name: true, leadStatus: true, followupDate: true },
      take: 50,
      orderBy: { followupDate: 'asc' },
    }),
    prisma.lead.count({ where: followupWhere }),
    prisma.task.findMany({
      where: taskWhere,
      select: { id: true, title: true, dueDate: true, priority: true },
      take: 50,
      orderBy: { dueDate: 'asc' },
    }),
    prisma.task.count({ where: taskWhere }),
    // Unseen chat messages addressed to me
    prisma.chatMessage.count({
      where: { toId: BigInt(userId), seen: 0 },
    }),
    // Recent flag messages:
    //   • admins see flags raised by counsellors (type = 'send' means counsellor sent/raised it)
    //   • counsellors see flags that admins have responded to / directed at them (type = 'rcv')
    prisma.flagMessage.findMany({
      where: { type: isAdmin ? 'send' : 'rcv' },
      take: 10,
      orderBy: { createdAt: 'desc' },
    }),
  ])

  // Projects whose next move is mine — the assignee waiting to hear back, the
  // rep with a proposal to send, a client reply nobody has read. Only for
  // customers with the module, so nobody else's schema is asked for the table.
  const waitingProjects = hasFeature('projects') ? await waitingOn(userId) : []

  // Money past its date and contracts coming up for renewal — for the people
  // who can act on them (managers and the owner). Only with the module.
  const salesDocs = hasFeature('sales_docs')
  const [overdueInvoices, renewingContracts] = salesDocs
    ? await Promise.all([
        prisma.crmInvoice.findMany({
          where: { status: { in: ['sent', 'partial'] }, dueDate: { lt: new Date() }, ...(isAdmin ? {} : { ownerId: BigInt(userId) }) },
          select: { id: true, invoiceNumber: true, total: true, amountPaid: true, dueDate: true, accountId: true },
          orderBy: { dueDate: 'asc' },
          take: 30,
        }),
        prisma.contract.findMany({
          where: { status: { in: ['signed', 'active'] }, renewalDate: { gte: new Date(), lte: new Date(Date.now() + 30 * 86_400_000) }, ...(isAdmin ? {} : { ownerId: BigInt(userId) }) },
          select: { id: true, contractNumber: true, title: true, renewalDate: true },
          orderBy: { renewalDate: 'asc' },
          take: 20,
        }),
      ])
    : [[], []]

  // hydrate flag-message lead names
  const leadIds = Array.from(new Set(flagMessages.map((m) => m.leadId)))
  const leads = leadIds.length
    ? await prisma.lead.findMany({
        where: { id: { in: leadIds } },
        select: { id: true, name: true },
      })
    : []
  const leadMap = new Map(leads.map((l) => [String(l.id), l]))

  const items: Array<Record<string, unknown>> = []

  for (const r of reminders) {
    items.push({
      type: 'reminder',
      id: `reminder-${r.id}`,
      title: 'Reminder',
      summary: `${r.lead?.name || 'Lead'}${r.note ? ` — ${r.note}` : ''}`,
      at: r.reminderDate.toISOString(),
      leadId: Number(r.leadId),
      link: `/app/leads/${Number(r.leadId)}`,
    })
  }

  for (const f of pendingFollowups) {
    const due = f.followupDate ? new Date(f.followupDate) : null
    const isOverdue = due ? due < today : false
    items.push({
      type: 'followup',
      id: `followup-${f.id}`,
      title: isOverdue ? 'Overdue Follow-up' : "Today's Follow-up",
      summary: `${f.name} (${f.leadStatus})`,
      at: due ? due.toISOString() : null,
      leadId: Number(f.id),
      link: `/app/leads/${Number(f.id)}`,
    })
  }

  for (const t of pendingTasks) {
    items.push({
      type: 'task',
      id: `task-${t.id}`,
      title: `Task: ${t.title}`,
      summary: `Priority: ${t.priority}${t.dueDate ? ` · due ${t.dueDate.toISOString().slice(0, 10)}` : ''}`,
      at: t.dueDate ? t.dueDate.toISOString() : null,
      link: '/app/tasks',
    })
  }

  for (const p of waitingProjects) {
    items.push({
      type: 'project',
      id: `project-${p.id}`,
      title: `Project: ${p.title}`,
      summary: `${p.projectNumber ?? ''} · ${p.status.replace(/_/g, ' ')}${p.clientName ? ` · ${p.clientName}` : ''}`,
      at: p.updatedAt.toISOString(),
      link: `/app/projects/${Number(p.id)}`,
    })
  }

  for (const inv of overdueInvoices) {
    const balance = Number(inv.total) - Number(inv.amountPaid)
    items.push({
      type: 'invoice',
      id: `invoice-${inv.id}`,
      title: `Overdue: ${inv.invoiceNumber}`,
      summary: `₹${balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })} past due${inv.dueDate ? ` since ${inv.dueDate.toISOString().slice(0, 10)}` : ''}`,
      at: inv.dueDate ? inv.dueDate.toISOString() : null,
      link: `/app/invoices/${Number(inv.id)}`,
    })
  }
  for (const ct of renewingContracts) {
    items.push({
      type: 'contract',
      id: `contract-${ct.id}`,
      title: `Renewal due: ${ct.title}`,
      summary: `${ct.contractNumber} · renews ${ct.renewalDate?.toISOString().slice(0, 10) ?? ''}`,
      at: ct.renewalDate ? ct.renewalDate.toISOString() : null,
      link: `/app/contracts/${Number(ct.id)}`,
    })
  }

  for (const m of flagMessages) {
    items.push({
      type: 'flag',
      id: `flag-${m.id}`,
      title: 'Flag Raised',
      summary: `${leadMap.get(String(m.leadId))?.name || `Lead #${m.leadId}`} — ${m.message.slice(0, 80)}`,
      at: m.createdAt.toISOString(),
      leadId: Number(m.leadId),
      link: `/app/leads/${Number(m.leadId)}`,
    })
  }

  // Counts are the SOURCE OF TRUTH for tab badges — they reflect the full DB total,
  // not the paginated `items` slice. Items are capped per type (take: 50) for payload size;
  // the UI shows "showing N of M" when a tab's true count exceeds what we sent.
  const totalCount = followupsTotal + remindersTotal + tasksTotal + flagMessages.length + unseenChat + waitingProjects.length + overdueInvoices.length + renewingContracts.length

  return c.json({
    count: totalCount,
    unseenChat,
    items: items.slice(0, 200),
    counts: {
      reminders: remindersTotal,
      followups: followupsTotal,
      // Legacy alias — kept so any older clients reading `overdueFollowups` don't break.
      overdueFollowups: followupsTotal,
      tasks: tasksTotal,
      // Legacy alias.
      pendingTasks: tasksTotal,
      flags: flagMessages.length,
      unseenChat,
      projects: waitingProjects.length,
      invoices: overdueInvoices.length,
      contracts: renewingContracts.length,
    },
  })
})

// PATCH /api/notifications/mark-read
// Called by the frontend when the user opens the notifications panel.
// For now this is a no-op acknowledgement — real per-item dismiss logic
// can be layered on top once a NotificationRead table exists.
// The client uses this to reset the local badge count optimistically.
notificationsRoutes.patch('/mark-read', async (c) => {
  // Future: upsert a NotificationRead row for the userId + timestamp
  return c.json({ ok: true })
})
