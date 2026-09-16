import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// 0001-01-01 is the sentinel value used to mark a lead as "no follow-up needed"
// (dead/junk leads). Render as N/A wherever a date is shown.
export function isNoFollowupDate(date: string | Date | null | undefined): boolean {
  if (!date) return false
  const d = typeof date === 'string' ? new Date(date) : date
  if (!(d instanceof Date) || isNaN(d.getTime())) return false
  return d.getUTCFullYear() <= 1
}

// Everything the CRM shows is in Asia/Kolkata regardless of where the viewer's
// machine is set — 'en-IN' alone only picks the format, not the timezone, so
// browsers on UTC/PST/etc. used to render IST-anchored data in local time and
// drift the displayed hour by 5–13 hours. Pinning timeZone here keeps the whole
// app on IST end-to-end.
const IST = 'Asia/Kolkata'

export function formatDate(date: string | Date | null | undefined) {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (!(d instanceof Date) || isNaN(d.getTime())) return '—'
  if (d.getUTCFullYear() <= 1) return 'N/A'

  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: IST,
  })
}

export function formatDateTime(date: string | Date | null | undefined) {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (!(d instanceof Date) || isNaN(d.getTime())) return '—'
  if (d.getUTCFullYear() <= 1) return 'N/A'

  const datePart = d.toLocaleDateString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: IST,
  })
  const timePart = d.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: IST,
  })
  return `${datePart} · ${timePart}`
}

// Normalize a phone number per the CRM's storage rule (matches backend
// src/utils/phone.ts):
//   - already starts with "+" → leave it
//   - 10 digits → leave as-is (local Indian number)
//   - 12 digits → prepend "+" and use just the digits
//   - anything else → leave it
export function normalizePhone(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return ''
  const trimmed = String(raw).trim()
  if (!trimmed) return trimmed
  if (trimmed.startsWith('+')) return trimmed

  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return trimmed
  if (digits.length === 12) return '+' + digits
  return trimmed
}

export function maskPhone(value: string | null | undefined, reveal: boolean): string {
  if (!value) return '—'
  if (reveal) return value
  const raw = String(value)
  const hasPlus = raw.startsWith('+')
  const digits = raw.replace(/\D/g, '')
  if (digits.length <= 5) return raw
  const masked = digits.slice(0, -5) + ' •••••'
  return hasPlus ? '+' + masked : masked
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function getFileUrl(filepath: string | null | undefined): string {
  if (!filepath) return '#'
  if (filepath.startsWith('http://') || filepath.startsWith('https://')) return filepath
  const cleanPath = filepath.startsWith('/') ? filepath : `/${filepath}`
  return cleanPath
}

