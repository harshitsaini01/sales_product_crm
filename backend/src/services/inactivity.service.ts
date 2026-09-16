import { prisma } from '../lib/prisma'

export interface InactivityConfig {
  enabled: boolean
  warningMinutes: number
  alertMinutes: number
  halfdayMinutes: number
}

export const DEFAULT_CONFIG: InactivityConfig = {
  enabled: true,
  warningMinutes: 3,
  alertMinutes: 6,
  halfdayMinutes: 15,
}

const SETTING_KEYS = {
  enabled: 'inactivity_tracker_enabled',
  warning: 'inactivity_warning_minutes',
  alert: 'inactivity_alert_minutes',
  halfday: 'inactivity_halfday_minutes',
} as const

function num(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export async function loadConfig(): Promise<InactivityConfig> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: Object.values(SETTING_KEYS) } },
  })
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    enabled: (map[SETTING_KEYS.enabled] ?? 'true') === 'true',
    warningMinutes: num(map[SETTING_KEYS.warning], DEFAULT_CONFIG.warningMinutes),
    alertMinutes: num(map[SETTING_KEYS.alert], DEFAULT_CONFIG.alertMinutes),
    halfdayMinutes: num(map[SETTING_KEYS.halfday], DEFAULT_CONFIG.halfdayMinutes),
  }
}

export async function saveConfig(input: Partial<InactivityConfig>) {
  const tasks: Promise<unknown>[] = []
  const upsert = (key: string, value: string) =>
    prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    })
  if (input.enabled !== undefined) tasks.push(upsert(SETTING_KEYS.enabled, String(input.enabled)))
  if (input.warningMinutes !== undefined) tasks.push(upsert(SETTING_KEYS.warning, String(input.warningMinutes)))
  if (input.alertMinutes !== undefined) tasks.push(upsert(SETTING_KEYS.alert, String(input.alertMinutes)))
  if (input.halfdayMinutes !== undefined) tasks.push(upsert(SETTING_KEYS.halfday, String(input.halfdayMinutes)))
  await Promise.all(tasks)
}

export type InactivityStage = 'ok' | 'warning' | 'alert' | 'halfday'

export interface InactivityStatus {
  enabled: boolean
  stage: InactivityStage
  inactiveSeconds: number
  thresholds: { warning: number; alert: number; halfday: number }
  lastActivityAt: string | null
  lastActivitySource: 'web' | 'mobile' | null
  onCall: boolean
  onCallSince: string | null
  // The most recent unack'd event of stage 'alert' / 'halfday' — the client
  // shows the full-page modal until ackAt is set.
  pendingEvent: {
    id: number
    kind: 'alert' | 'halfday'
    raisedAt: string
  } | null
}

// Safety net — if the mobile app crashes or loses network mid-call, we'd
// otherwise leave `onCallSince` set forever. Treat a stale value as "not on a
// call" and clear it on the next status read.
const ON_CALL_STALE_MS = 4 * 60 * 60 * 1000 // 4 hours

export function computeStage(
  inactiveSeconds: number,
  cfg: InactivityConfig,
): InactivityStage {
  if (!cfg.enabled) return 'ok'
  if (inactiveSeconds >= cfg.halfdayMinutes * 60) return 'halfday'
  if (inactiveSeconds >= cfg.alertMinutes * 60) return 'alert'
  if (inactiveSeconds >= cfg.warningMinutes * 60) return 'warning'
  return 'ok'
}

export async function getStatus(userId: number): Promise<InactivityStatus> {
  const cfg = await loadConfig()
  const user = await prisma.user.findUnique({
    where: { id: BigInt(userId) },
    select: {
      lastActivityAt: true,
      lastActivitySource: true,
      onCallSince: true,
    },
  })
  const last = user?.lastActivityAt ?? new Date()
  const inactiveSeconds = Math.max(0, Math.floor((Date.now() - last.getTime()) / 1000))

  // Treat stale on-call markers as "not on a call". Don't write to the DB here
  // (status is read-mostly) — the scheduler clears it the next time it ticks.
  const onCallSince = user?.onCallSince ?? null
  const onCallFresh =
    !!onCallSince && Date.now() - onCallSince.getTime() < ON_CALL_STALE_MS

  // While the user is on a call, force stage to 'ok' — they shouldn't see a
  // warning popup mid-call, and the timer effectively pauses.
  const rawStage = computeStage(inactiveSeconds, cfg)
  const stage: InactivityStage = onCallFresh ? 'ok' : rawStage

  // Pull the latest unacked alert/halfday so the modal stays sticky until ack'd.
  const pending = await prisma.inactivityEvent.findFirst({
    where: { userId: BigInt(userId), ackAt: null, kind: { in: ['alert', 'halfday'] } },
    orderBy: { raisedAt: 'desc' },
  })

  return {
    enabled: cfg.enabled,
    stage,
    inactiveSeconds,
    thresholds: {
      warning: cfg.warningMinutes * 60,
      alert: cfg.alertMinutes * 60,
      halfday: cfg.halfdayMinutes * 60,
    },
    lastActivityAt: user?.lastActivityAt?.toISOString() ?? null,
    lastActivitySource: (user?.lastActivitySource as 'web' | 'mobile' | null) ?? null,
    onCall: onCallFresh,
    onCallSince: onCallFresh ? onCallSince!.toISOString() : null,
    pendingEvent: pending
      ? {
          id: Number(pending.id),
          kind: pending.kind as 'alert' | 'halfday',
          raisedAt: pending.raisedAt.toISOString(),
        }
      : null,
  }
}

export async function ackPendingEvents(userId: number): Promise<number> {
  const now = new Date()
  const result = await prisma.inactivityEvent.updateMany({
    where: { userId: BigInt(userId), ackAt: null },
    data: { ackAt: now },
  })
  // Also nudge lastActivityAt so the counter resets on ack.
  await prisma.user.update({
    where: { id: BigInt(userId) },
    data: { lastActivityAt: now },
  })
  return result.count
}

export async function pingActivity(userId: number, kind: 'web' | 'mobile') {
  await prisma.user.update({
    where: { id: BigInt(userId) },
    data: { lastActivityAt: new Date(), lastActivitySource: kind },
  })
}

/**
 * Mobile app reports a phone-call start/end. While `onCallSince` is set the
 * scheduler skips raising new events for this user; on call-end we credit the
 * full call duration as activity so they aren't immediately warned afterwards.
 *
 * `since` is optional — when provided we trust the client's clock for the
 * actual call-start moment, otherwise we use server now. We never trust the
 * client for the end time though; the server stamps that.
 */
export async function setPhoneState(
  userId: number,
  onCall: boolean,
  since?: Date,
) {
  const now = new Date()
  if (onCall) {
    // Don't overwrite an already-running call timestamp; that would lose the
    // original start time if the mobile app fires duplicate "onCall: true".
    const existing = await prisma.user.findUnique({
      where: { id: BigInt(userId) },
      select: { onCallSince: true },
    })
    const onCallSince = existing?.onCallSince ?? since ?? now
    await prisma.user.update({
      where: { id: BigInt(userId) },
      data: {
        onCallSince,
        onCallUpdatedAt: now,
        lastActivityAt: now,
        lastActivitySource: 'mobile',
      },
    })
    return { onCall: true, onCallSince: onCallSince.toISOString() }
  }

  // Call ended — clear the marker and credit the call as activity. This is the
  // key UX promise: hanging up does not immediately tip you into a warning.
  await prisma.user.update({
    where: { id: BigInt(userId) },
    data: {
      onCallSince: null,
      onCallUpdatedAt: now,
      lastActivityAt: now,
      lastActivitySource: 'mobile',
    },
  })
  return { onCall: false, onCallSince: null }
}
