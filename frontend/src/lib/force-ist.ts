// Force every date/time render across the app to Asia/Kolkata, regardless of
// the viewer's browser timezone. The CRM is India-only — leads are Indian, the
// counsellors are Indian, timings are quoted to Indian students — so a VPN or a
// misconfigured PC must never make times drift by 5–13 hours.
//
// We monkey-patch three surfaces:
//   1. Date.prototype.{toLocaleString,toLocaleDateString,toLocaleTimeString}
//      → inject { timeZone: 'Asia/Kolkata' } when the caller didn't specify one.
//   2. Intl.DateTimeFormat constructor → same default.
//   3. `en-IN` is used as the default locale so numbers/months read the Indian
//      way (dd/mm/yyyy).
//
// If a call site EXPLICITLY passes a timeZone (say for a "show in your local
// tz" toggle later), we honour it. This only affects the default.
//
// Imported once, side-effect only, from main.tsx before React mounts.

const IST = 'Asia/Kolkata'
const DEFAULT_LOCALE = 'en-IN'

function withDefaults(
  locales: Intl.LocalesArgument,
  options: Intl.DateTimeFormatOptions | undefined,
): [Intl.LocalesArgument, Intl.DateTimeFormatOptions] {
  const opts: Intl.DateTimeFormatOptions = { ...(options ?? {}) }
  if (!opts.timeZone) opts.timeZone = IST
  const loc = locales ?? DEFAULT_LOCALE
  return [loc, opts]
}

const origToLocaleString = Date.prototype.toLocaleString
Date.prototype.toLocaleString = function (
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
): string {
  const [loc, opts] = withDefaults(locales, options)
  return origToLocaleString.call(this, loc, opts)
}

const origToLocaleDateString = Date.prototype.toLocaleDateString
Date.prototype.toLocaleDateString = function (
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
): string {
  const [loc, opts] = withDefaults(locales, options)
  return origToLocaleDateString.call(this, loc, opts)
}

const origToLocaleTimeString = Date.prototype.toLocaleTimeString
Date.prototype.toLocaleTimeString = function (
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
): string {
  const [loc, opts] = withDefaults(locales, options)
  return origToLocaleTimeString.call(this, loc, opts)
}

// Intl.DateTimeFormat is the underlying API — some libraries (charts, tooltip
// formatters) reach for it directly instead of the Date prototype methods.
const OrigDTF = Intl.DateTimeFormat
function PatchedDTF(
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const [loc, opts] = withDefaults(locales, options)
  return new OrigDTF(loc, opts)
}
PatchedDTF.supportedLocalesOf = OrigDTF.supportedLocalesOf.bind(OrigDTF)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(Intl as any).DateTimeFormat = PatchedDTF
