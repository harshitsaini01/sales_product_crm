import { Hono } from 'hono'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/auth'
import { superAdminOnly } from '../middleware/rbac'

export const locationsRoutes = new Hono()
locationsRoutes.use('*', authenticate)

// Admin-only team overview: latest known location + on/off status for every
// counsellor with tracking enabled, in one call — avoids opening each
// counsellor's profile individually to check whether they're being tracked.
locationsRoutes.get('/status', superAdminOnly, async (c) => {
  const trackedUsers = await prisma.user.findMany({
    where: { locationTrackingEnabled: true, status: 1 },
    select: { id: true, name: true, role: true, locationRequired: true },
    orderBy: { name: 'asc' },
  })
  const userIds = trackedUsers.map((u) => u.id)
  const [latestPoints, deviceStatuses] = userIds.length
    ? await Promise.all([
        prisma.userLocation.findMany({
          where: { userId: { in: userIds } },
          orderBy: { recordedAt: 'desc' },
          distinct: ['userId'],
        }),
        prisma.userDeviceLocationStatus.findMany({ where: { userId: { in: userIds } } }),
      ])
    : [[], []]
  const latestByUser = new Map(latestPoints.map((p) => [p.userId.toString(), p]))
  const deviceByUser = new Map(deviceStatuses.map((d) => [d.userId.toString(), d]))
  const staleAfterMs = 2 * 60 * 1000 // service samples every ~30s; 2 min of silence means tracking has stopped

  return c.json({
    counsellors: trackedUsers.map((u) => {
      const latest = latestByUser.get(u.id.toString())
      const device = deviceByUser.get(u.id.toString())
      const ageMs = latest ? Date.now() - latest.recordedAt.getTime() : null
      const state: 'live' | 'stale' | 'never' = !latest ? 'never' : ageMs !== null && ageMs <= staleAfterMs ? 'live' : 'stale'
      return {
        id: Number(u.id),
        name: u.name,
        role: u.role,
        locationRequired: u.locationRequired,
        state,
        lastSeenAt: latest?.recordedAt.toISOString() ?? null,
        lastLatitude: latest?.latitude ?? null,
        lastLongitude: latest?.longitude ?? null,
        lastBearingDeg: latest?.bearingDeg ?? null,
        blockReason: blockReasonFor(device),
        permissions: device
          ? {
              location: device.permissionGranted,
              backgroundLocation: device.backgroundGranted,
              gps: device.gpsEnabled,
              battery: device.batteryExempt,
              callPhone: device.callPhoneGranted,
              phoneState: device.phoneStateGranted,
              callLog: device.callLogGranted,
              recordAudio: device.recordAudioGranted,
              notifications: device.notificationsGranted,
              reportedAt: device.updatedAt.toISOString(),
            }
          : null,
      }
    }),
  })
})

// The device reports which requirement it is blocked on (AppPermissionGate), so
// the admin sees the exact cause — e.g. GPS is on but location permission was
// revoked, or calling permission is missing — instead of a generic "stale"
// badge. The per-flag fallback below covers devices on older app builds that
// don't send blockReason yet, and mirrors the app's own ordering.
function blockReasonFor(
  device:
    | {
        permissionGranted: boolean
        backgroundGranted: boolean
        gpsEnabled: boolean
        batteryExempt: boolean
        callPhoneGranted: boolean
        phoneStateGranted: boolean
        callLogGranted: boolean
        recordAudioGranted: boolean
        notificationsGranted: boolean
        blocked: boolean
        blockReason: string | null
        updatedAt: Date
      }
    | undefined,
): string | null {
  if (!device) return null
  if (device.blockReason) return device.blockReason
  if (!device.permissionGranted) return device.gpsEnabled ? 'Location permission is off (device GPS is on)' : 'Location permission is off'
  if (!device.backgroundGranted) return 'Not set to "Allow all the time"'
  if (!device.gpsEnabled) return 'Device GPS is off'
  if (!device.batteryExempt) return 'Battery optimization is killing tracking'
  if (!device.callPhoneGranted) return 'Calling permission is off'
  if (!device.phoneStateGranted) return 'Phone access is off'
  if (!device.callLogGranted) return 'Call log access is off'
  if (!device.recordAudioGranted) return 'Microphone access is off'
  if (!device.notificationsGranted) return 'Notifications are off'
  return null
}

// Admin-only timeline. Location is sensitive operational data and is not
// returned from the broad /users/:id profile endpoint.
locationsRoutes.get('/users/:id', superAdminOnly, async (c) => {
  const userId = BigInt(c.req.param('id'))
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 200), 1), 500)
  const before = c.req.query('before')
  const date = c.req.query('date')
  const beforeDate = before ? new Date(before) : null
  if (beforeDate && Number.isNaN(beforeDate.getTime())) return c.json({ error: 'Invalid before date' }, 400)
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'Invalid date' }, 400)
  const dayStart = date ? new Date(`${date}T00:00:00`) : null
  const dayEnd = date ? new Date(`${date}T23:59:59.999`) : null

  const points = await prisma.userLocation.findMany({
    where: { userId, ...(dayStart && dayEnd ? { recordedAt: { gte: dayStart, lte: dayEnd } } : beforeDate ? { recordedAt: { lt: beforeDate } } : {}) },
    orderBy: { recordedAt: 'desc' },
    take: limit + 1,
  })
  const hasMore = points.length > limit
  const rows = points.slice(0, limit)
  return c.json({
    points: rows.map((p) => ({
      id: Number(p.id), latitude: p.latitude, longitude: p.longitude,
      accuracyM: p.accuracyM, altitudeM: p.altitudeM, speedMps: p.speedMps, bearingDeg: p.bearingDeg,
      recordedAt: p.recordedAt.toISOString(),
    })),
    nextBefore: hasMore ? rows[rows.length - 1]?.recordedAt.toISOString() : null,
  })
})