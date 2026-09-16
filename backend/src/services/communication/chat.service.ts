import { prisma } from '../../lib/prisma'
import { bigintFix } from '../../utils/bigint-fix'

// ─── GET CHAT USERS (for internal chat sidebar) ───────────────────────────────
export async function getChatUsers(currentUserId: bigint) {
  // Get all active users except self, with last message + unread count
  const users = await prisma.user.findMany({
    where: { id: { not: currentUserId }, status: 1 },
    select: {
      id: true, name: true, role: true, designation: true,
      chatMessages: {
        where: { toId: currentUserId },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { message: true, createdAt: true },
      },
      receivedMessages: {
        where: { fromId: currentUserId },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { message: true, createdAt: true },
      },
    },
    orderBy: { name: 'asc' },
  })

  // Count unread messages from each user
  const unreadCounts = await prisma.chatMessage.groupBy({
    by: ['fromId'],
    where: { toId: currentUserId, seen: 0 },
    _count: { id: true },
  })

  const unreadMap = new Map(unreadCounts.map((u) => [Number(u.fromId), u._count.id]))

  return bigintFix(users.map((u) => ({
    id: Number(u.id),
    name: u.name,
    role: u.role,
    designation: u.designation,
    unread: unreadMap.get(Number(u.id)) || 0,
  })))
}

// ─── GET MESSAGES WITH A USER ─────────────────────────────────────────────────
export async function getMessages(fromId: bigint, toId: bigint, limit = 50) {
  const messages = await prisma.chatMessage.findMany({
    where: {
      OR: [
        { fromId, toId },
        { fromId: toId, toId: fromId },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: {
      from: { select: { id: true, name: true } },
    },
  })
  return bigintFix(messages)
}

// ─── SEND MESSAGE ──────────────────────────────────────────────────────────────
export async function sendMessage(data: { fromId: bigint; toId: bigint; message: string }) {
  const msg = await prisma.chatMessage.create({
    data: { fromId: data.fromId, toId: data.toId, message: data.message, seen: 0 },
    include: { from: { select: { id: true, name: true } } },
  })
  return bigintFix(msg)
}

// ─── MARK MESSAGES AS READ ────────────────────────────────────────────────────
export async function markAsRead(fromId: bigint, toId: bigint) {
  await prisma.chatMessage.updateMany({
    where: { fromId, toId, seen: 0 },
    data: { seen: 1 },
  })
}

// ─── GET UNREAD COUNT ─────────────────────────────────────────────────────────
export async function getUnreadCount(userId: bigint) {
  const count = await prisma.chatMessage.count({
    where: { toId: userId, seen: 0 },
  })
  return count
}

// ─── CLEAR CHAT (delete all between two users) ────────────────────────────────
export async function clearChat(fromId: bigint, toId: bigint) {
  await prisma.chatMessage.deleteMany({
    where: {
      OR: [
        { fromId, toId },
        { fromId: toId, toId: fromId },
      ],
    },
  })
}
