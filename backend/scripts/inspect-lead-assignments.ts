import { prisma } from '../src/lib/prisma'

async function inspectAssignments() {
  const mails = await (prisma as any).universityApplicationMail.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: {
      student: {
        select: {
          id: true,
          name: true,
          assignedTo: {
            where: { status: 1 },
            select: { id: true, clrId: true, status: true },
          },
        },
      },
    },
  })

  console.log('UNIVERSITY MAILS WITH ACTIVE ASSIGNMENTS:')
  for (const m of mails) {
    console.log({
      mailId: Number(m.id),
      studentId: Number(m.studentId),
      studentName: m.student?.name,
      sentByUserId: Number(m.sentByUserId),
      activeAssignments: m.student?.assignedTo?.map((a: any) => ({ clrId: Number(a.clrId) })),
    })
  }
}

inspectAssignments().catch(console.error)
