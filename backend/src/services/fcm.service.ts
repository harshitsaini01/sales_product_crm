import { initializeApp, cert, getApps, type App } from 'firebase-admin/app'
import { getMessaging, type Messaging } from 'firebase-admin/messaging'
import { readFileSync } from 'fs'

let app: App | null = null
let messaging: Messaging | null = null

function init() {
  if (messaging) return messaging
  const path = process.env.FCM_SERVICE_ACCOUNT_PATH
  if (!path) {
    console.warn('[fcm] FCM_SERVICE_ACCOUNT_PATH not set — push notifications disabled')
    return null
  }
  if (!getApps().length) {
    const credentials = JSON.parse(readFileSync(path, 'utf8'))
    app = initializeApp({ credential: cert(credentials) })
  }
  messaging = getMessaging(app!)
  return messaging
}

export interface CtcPayload {
  callId: string
  phone: string
  leadId?: string
  leadName?: string
  triggeredBy?: string
}

export async function sendClickToCall(fcmToken: string, payload: CtcPayload): Promise<boolean> {
  const m = init()
  if (!m) return false
  try {
    await m.send({
      token: fcmToken,
      data: { type: 'CTC', ...payload },
      android: {
        priority: 'high',
        ttl: 60 * 1000,
      },
    })
    return true
  } catch (err) {
    console.error('[fcm] send failed', err)
    return false
  }
}

export async function sendDataMessage(
  fcmToken: string,
  data: Record<string, string>
): Promise<boolean> {
  const m = init()
  if (!m) return false
  try {
    await m.send({
      token: fcmToken,
      data,
      android: { priority: 'high' },
    })
    return true
  } catch (err) {
    console.error('[fcm] send failed', err)
    return false
  }
}
