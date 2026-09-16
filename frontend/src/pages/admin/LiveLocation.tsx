import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapPin, Radio, Route, Search, Users } from 'lucide-react'
import { usersApi, type CounsellorDevicePermissions, type CounsellorLocationStatus, type UserLocationPoint } from '@/lib/api'

// React-Leaflet v4 runs with the CRM's React 18 version. These aliases avoid
// the workspace's hoisted Leaflet type-resolution mismatch.
const OpenStreetMap = MapContainer as any
const OpenStreetTiles = TileLayer as any
/**
 * Fixes coarser than this are noise, not position. ~50 m is about the width of
 * the street someone is standing on; beyond that the point means "somewhere in
 * this neighbourhood" and is actively misleading once drawn as a dot.
 */
const MAX_PLOT_ACCURACY_M = 50

const RouteLine = Polyline as any
const RoutePoint = CircleMarker as any
const CurrentLocationMarker = Marker as any
const PointTooltip = Tooltip as any

// A position only counts as "current" while the device is still reporting.
// Matches the backend's own live/stale threshold so the map and the team grid
// never disagree about who is actually live.
const LIVE_THRESHOLD_MS = 2 * 60 * 1000

/**
 * Map-pin pointer whose head carries the counsellor's initials, tipped at the
 * exact coordinate. Blue + pulsing while the position is genuinely current;
 * amber and still once it goes stale, so a 30-minute-old coordinate can never
 * read as "here right now". The little rotating arrow orbits the head to show
 * heading when the device reports a bearing.
 */
function currentLocationIcon(opts: { bearingDeg: number | null; fresh: boolean; initials: string }) {
  const { bearingDeg, fresh, initials } = opts
  const body = fresh ? '#2563eb' : '#d97706'
  const pulse = fresh ? '<span class="crm-live-pulse"></span>' : ''
  const arrow = bearingDeg !== null
    ? `<span class="crm-pin-heading" style="transform:rotate(${bearingDeg}deg)"><svg viewBox="0 0 24 24" width="46" height="46"><path d="M12 1.5 L15.2 8 L12 6.4 L8.8 8 Z" fill="${body}" stroke="white" stroke-width="1.2" stroke-linejoin="round"/></svg></span>`
    : ''
  const pin = `
    <svg class="crm-pin" viewBox="0 0 40 52" width="40" height="52">
      <path d="M20 51 C20 51 37 30.5 37 19 A17 17 0 1 0 3 19 C3 30.5 20 51 20 51 Z" fill="${body}" stroke="white" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="20" cy="19" r="11.5" fill="white" fill-opacity="0.92"/>
      <text x="20" y="19" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="700" font-family="ui-sans-serif,system-ui,sans-serif" fill="${body}">${initials}</text>
    </svg>`
  return L.divIcon({
    className: 'crm-current-location-icon',
    html: `${pulse}${arrow}${pin}`,
    iconSize: [40, 52],
    // Anchor at the pin's tip, not its centre, so it points at the real coordinate.
    iconAnchor: [20, 51],
    popupAnchor: [0, -46],
    tooltipAnchor: [0, -46],
  })
}

type CounsellorOption = { id: number; name: string; role: string; designation?: string }

export default function LiveLocation() {
  const today = new Date().toISOString().slice(0, 10)
  const [counsellorId, setCounsellorId] = useState<number | null>(null)
  const [date, setDate] = useState(today)
  const [selected, setSelected] = useState<UserLocationPoint | null>(null)

  const { data: counsellors = [] } = useQuery<CounsellorOption[]>({
    queryKey: ['users', 'counsellors'],
    queryFn: usersApi.counsellors,
  })
  const selectedCounsellor = counsellors.find((c) => c.id === counsellorId)
  // "Viewing today" — drives polling and map-follow, NOT the live/stale label.
  const isToday = counsellorId !== null && date === today
  // Re-render on a timer so "23m ago" keeps counting up even when no new point
  // arrives; without this a stalled device freezes the age text at its last value.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])
  const { data, isLoading: locationsLoading, dataUpdatedAt } = useQuery({
    queryKey: ['live-location', counsellorId, date],
    queryFn: () => usersApi.locations(counsellorId!, { date, limit: 500 }),
    enabled: counsellorId !== null,
    refetchInterval: isToday ? 15_000 : false,
  })

  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey: ['live-location', 'team-status'],
    queryFn: usersApi.locationStatus,
    refetchInterval: 15_000,
  })
  const teamStatus = statusData?.counsellors ?? []
  const selectedStatus = teamStatus.find((c) => c.id === counsellorId) ?? null

  const rawPoints = data?.points ?? []
  // Drop coarse fixes before anything is drawn.
  //
  // A counsellor standing still for an hour rendered as a dense blob with long
  // spikes shooting out of it: indoors the phone's fused provider falls back to
  // wifi/cell and returns points accurate to 50-500 m, and the map plotted each
  // one as an exact dot AND joined it into the route line — so every bad fix
  // drew a spike out and back. The accuracy was recorded all along, just never
  // used. The app now filters these before upload too, but this also cleans up
  // every point already in the database.
  const points = useMemo(
    () => rawPoints.filter((p) => p.accuracyM == null || p.accuracyM <= MAX_PLOT_ACCURACY_M),
    [rawPoints],
  )
  const hiddenCount = rawPoints.length - points.length
  const route = useMemo<[number, number][]>(
    () => points.slice().reverse().map((point) => [point.latitude, point.longitude]),
    [points],
  )
  const latest = points[0]
  // The actual test for "is this where they are right now": how old the newest
  // coordinate is. A 30-minute-old point is a last-known position, not a live one.
  const latestAgeMs = latest ? Date.now() - new Date(latest.recordedAt).getTime() : null
  const isFresh = isToday && latestAgeMs !== null && latestAgeMs <= LIVE_THRESHOLD_MS

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <style>{`
        .crm-current-location-icon { position: relative; }
        /* Pin is anchored at its tip (bottom centre); the pulse and heading arrow
           orbit the pin HEAD, which sits 19px down from the top of a 52px icon. */
        .crm-pin { position: absolute; top: 0; left: 0; filter: drop-shadow(0 3px 5px rgba(0,0,0,0.3)); z-index: 2; }
        .crm-live-pulse { position: absolute; top: 19px; left: 50%; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 9999px; background: rgba(37, 99, 235, 0.4); animation: crm-live-pulse-anim 1.8s ease-out infinite; z-index: 1; }
        .crm-pin-heading { position: absolute; top: 19px; left: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; transform-origin: 50% 50%; z-index: 3; }
        @keyframes crm-live-pulse-anim { 0% { transform: scale(0.5); opacity: 0.85; } 100% { transform: scale(2.6); opacity: 0; } }
      `}</style>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Radio className="w-6 h-6 text-emerald-600" /> Live Location</h1>
        <p className="mt-1 text-sm text-gray-500">Pick a counsellor below to see their live route move in real time.</p>
      </div>

      <CounsellorGrid
        team={teamStatus}
        counsellors={counsellors}
        loading={statusLoading}
        selectedId={counsellorId}
        onSelect={(id) => { setCounsellorId(id); setDate(today); setSelected(null) }}
      />

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap items-center gap-4">
        <div className="text-sm font-medium text-gray-800">{selectedCounsellor ? selectedCounsellor.name : 'No counsellor selected'}</div>
        <label className="flex items-center gap-2 text-xs text-gray-500"><span className="font-bold uppercase tracking-wide">Date</span><input type="date" value={date} max={today} onChange={(e) => { setDate(e.target.value); setSelected(null) }} className="rounded-lg border px-2.5 py-1.5 text-sm" /></label>
        {isToday && (isFresh
          ? <div className="inline-flex h-8 items-center gap-2 rounded-lg bg-emerald-50 px-3 text-xs font-semibold text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Live · refreshing every 15s</div>
          : latest
            ? <div className="inline-flex h-8 items-center gap-2 rounded-lg bg-amber-50 px-3 text-xs font-semibold text-amber-700"><span className="h-2 w-2 rounded-full bg-amber-500" /> Not updating · last point {timeAgo(latest.recordedAt)} ago</div>
            : null)}
      </div>

      {selectedStatus && <DevicePermissionPanel status={selectedStatus} />}

      {counsellorId === null ? <EmptyState /> : locationsLoading ? <div className="h-[32rem] rounded-2xl border bg-white flex items-center justify-center text-sm text-gray-400">Loading {selectedCounsellor?.name ?? 'counsellor'}’s route…</div> : points.length === 0 ? <div className="h-72 rounded-2xl border bg-white flex flex-col items-center justify-center text-gray-400"><MapPin className="w-8 h-8 mb-3" /><p>No location points for this date.</p></div> : <>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between gap-3 flex-wrap"><div><h2 className="font-bold text-gray-900">{selectedCounsellor?.name}’s route</h2><p className="text-xs text-gray-500 mt-0.5">Hover any marker to see its recorded time; click it for details.</p></div><div className="text-xs text-gray-500 flex items-center gap-3"><span><Route className="inline w-3.5 h-3.5 mr-1" />{points.length} points</span><span>{latest ? `Latest: ${new Date(latest.recordedAt).toLocaleTimeString()}` : ''}</span></div></div>
          <div className="h-[32rem]">
            <OpenStreetMap key={`${counsellorId}-${date}`} center={route[route.length - 1]} zoom={14} scrollWheelZoom className="h-full w-full">
              <OpenStreetTiles attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <RouteBounds route={route} follow={isToday} />
              <RouteLine positions={route} pathOptions={{ color: '#2563eb', weight: 4 }} />
              {points.slice(1).map((point) => (
                <RoutePoint key={point.id} center={[point.latitude, point.longitude]} radius={selected?.id === point.id ? 8 : 4} pathOptions={{ color: '#2563eb', fillColor: '#60a5fa', fillOpacity: 1 }} eventHandlers={{ click: () => setSelected(point) }}>
                  <PointTooltip direction="top" offset={[0, -6]} opacity={1}>{new Date(point.recordedAt).toLocaleString()}</PointTooltip>
                  <Popup><strong>Route point</strong><br />{new Date(point.recordedAt).toLocaleString()}<br />Accuracy: {point.accuracyM ? `${Math.round(point.accuracyM)} m` : 'unknown'}</Popup>
                </RoutePoint>
              ))}
              {latest && (
                <AnimatedCurrentMarker
                  point={latest}
                  fresh={isFresh}
                  animate={isToday}
                  name={selectedCounsellor?.name ?? ''}
                  onSelect={() => setSelected(latest)}
                />
              )}
            </OpenStreetMap>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"><div className="px-5 py-3 border-b text-sm font-bold text-gray-900">Movement timeline</div><div className="max-h-72 overflow-y-auto divide-y">{points.map((point, index) => <button type="button" key={point.id} onClick={() => setSelected(point)} className={`w-full px-5 py-3 text-left hover:bg-emerald-50 ${selected?.id === point.id ? 'bg-emerald-50' : ''}`}><div className="flex items-center justify-between gap-4"><span className="text-sm font-medium text-gray-800">{index === 0 ? (isFresh ? 'Live now · ' : `Last point (${timeAgo(point.recordedAt)} ago) · `) : ''}{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</span><span className="text-xs text-gray-500 shrink-0">{new Date(point.recordedAt).toLocaleString()}</span></div></button>)}</div><div className="px-5 py-2 text-[11px] text-gray-400 border-t">{hiddenCount > 0 ? `${hiddenCount} low-accuracy point${hiddenCount === 1 ? '' : 's'} hidden (worse than ${MAX_PLOT_ACCURACY_M} m) · ` : ''}{dataUpdatedAt ? `Last CRM refresh: ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ''}</div></div>
      </>}
    </div>
  )
}

// Animates the live marker's glide between polls instead of snapping it from
// point A to point B — the same "smooth moving puck" feel Uber/Google Maps
// give a live-tracked position between low-frequency GPS updates. Rotation
// follows the device's reported bearing when available.
function AnimatedCurrentMarker({ point, fresh, animate, name, onSelect }: { point: UserLocationPoint; fresh: boolean; animate: boolean; name: string; onSelect: () => void }) {
  const markerRef = useRef<L.Marker | null>(null)
  const animRef = useRef<number | null>(null)
  const prevLatLng = useRef<[number, number] | null>(null)

  useEffect(() => {
    const marker = markerRef.current
    if (!marker) return
    const to: [number, number] = [point.latitude, point.longitude]
    const from = prevLatLng.current
    prevLatLng.current = to
    if (animRef.current !== null) cancelAnimationFrame(animRef.current)
    if (!animate || !from || (from[0] === to[0] && from[1] === to[1])) {
      marker.setLatLng(to)
      return
    }
    const duration = 1100
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
      marker.setLatLng([from[0] + (to[0] - from[0]) * eased, from[1] + (to[1] - from[1]) * eased])
      if (t < 1) animRef.current = requestAnimationFrame(step)
    }
    animRef.current = requestAnimationFrame(step)
    return () => { if (animRef.current !== null) cancelAnimationFrame(animRef.current) }
  }, [point.latitude, point.longitude, animate])

  const icon = useMemo(
    () => currentLocationIcon({ bearingDeg: point.bearingDeg ?? null, fresh, initials: initials(name) }),
    [point.bearingDeg, fresh, name],
  )

  // Never claim "currently here" for a coordinate that stopped updating — say
  // how old it actually is, which is the difference between a live position and
  // wherever the counsellor happened to be half an hour ago.
  const age = timeAgo(point.recordedAt)
  const label = fresh ? 'Currently here' : `Last seen here · ${age} ago`

  return (
    <CurrentLocationMarker ref={markerRef} position={[point.latitude, point.longitude]} icon={icon} eventHandlers={{ click: onSelect }}>
      <PointTooltip direction="top" opacity={1} permanent>{label}</PointTooltip>
      <Popup>
        <strong>{fresh ? 'Current location' : 'Last known location'}</strong>
        <br />{new Date(point.recordedAt).toLocaleString()}
        {!fresh && <><br />Not updating — {age} old</>}
        <br />Accuracy: {point.accuracyM ? `${Math.round(point.accuracyM)} m` : 'unknown'}
      </Popup>
    </CurrentLocationMarker>
  )
}

// Mirrors AppPermissionGate's requirement order in the app, so what the admin
// reads here is the same sequence the counsellor is walked through on-device.
const PERMISSION_ROWS: { key: keyof CounsellorDevicePermissions; label: string }[] = [
  { key: 'location', label: 'Location' },
  { key: 'backgroundLocation', label: 'All-time location' },
  { key: 'gps', label: 'Device GPS' },
  { key: 'battery', label: 'Battery unrestricted' },
  { key: 'callPhone', label: 'Calling' },
  { key: 'phoneState', label: 'Phone access' },
  { key: 'callLog', label: 'Call log' },
  { key: 'recordAudio', label: 'Microphone' },
  { key: 'notifications', label: 'Notifications' },
]

function DevicePermissionPanel({ status }: { status: CounsellorLocationStatus }) {
  const perms = status.permissions
  if (!perms) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 text-sm text-gray-500">
        <span className="font-bold text-gray-900">Device permissions</span> — no report yet from {status.name}'s phone. They need app v1.1.28+ and to open the app once.
      </div>
    )
  }
  const missing = PERMISSION_ROWS.filter((r) => !perms[r.key])
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
        <span className="font-bold text-gray-900 text-sm">Device permissions</span>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${missing.length === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {missing.length === 0 ? 'App fully enabled' : `App blocked · ${missing.length} missing`}
        </span>
      </div>
      <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {PERMISSION_ROWS.map((row) => {
          const ok = perms[row.key] as boolean
          return (
            <div key={row.key} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs ${ok ? 'bg-gray-50 text-gray-600' : 'bg-red-50 text-red-700 font-semibold'}`}>
              <span className={`h-2 w-2 rounded-full shrink-0 ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="truncate">{row.label}</span>
            </div>
          )
        })}
      </div>
      <div className="px-5 py-2 text-[11px] text-gray-400 border-t">Device reported {timeAgo(perms.reportedAt)} ago</div>
    </div>
  )
}

const STATE_RING: Record<CounsellorLocationStatus['state'], string> = { live: 'ring-emerald-400', stale: 'ring-red-400', never: 'ring-gray-200' }
const STATE_DOT: Record<CounsellorLocationStatus['state'], string> = { live: 'bg-emerald-500 animate-pulse', stale: 'bg-red-500', never: 'bg-gray-300' }
const AVATAR_BG = ['bg-blue-100 text-blue-700', 'bg-violet-100 text-violet-700', 'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-teal-100 text-teal-700', 'bg-indigo-100 text-indigo-700']

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}

function timeAgo(iso: string | null) {
  if (!iso) return 'never'
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return new Date(iso).toLocaleDateString()
}

// Small compact cards, everyone visible at a glance — replaces the old single
// dropdown-plus-search combo, which only ever showed one name at a time.
function CounsellorGrid({
  team,
  counsellors,
  loading,
  selectedId,
  onSelect,
}: {
  team: CounsellorLocationStatus[]
  counsellors: CounsellorOption[]
  loading: boolean
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  const [search, setSearch] = useState('')
  const statusById = new Map(team.map((c) => [c.id, c]))
  // Union of both lists: team-status only includes tracking-enabled users, but a
  // counsellor might not be enabled yet — still show them, just with a "never" dot.
  const merged = counsellors.map((c) => ({
    id: c.id,
    name: c.name,
    status: statusById.get(c.id),
  }))
  const filtered = search.trim()
    ? merged.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
    : merged
  const liveCount = team.filter((c) => c.state === 'live').length
  const offCount = team.filter((c) => c.state === 'stale').length

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-bold text-gray-900">Team tracking status</h2>
          <p className="text-xs text-gray-500 mt-0.5">Everyone's live status at a glance — click anyone to load their route.</p>
        </div>
        <div className="flex items-center gap-3">
          {!loading && team.length > 0 && (
            <div className="text-xs text-gray-500 flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />{liveCount} live</span>
              {offCount > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" />{offCount} off</span>}
            </div>
          )}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name…"
              className="pl-8 pr-3 py-1.5 text-xs rounded-lg border bg-white w-40"
            />
          </div>
        </div>
      </div>
      {loading ? (
        <div className="px-5 py-6 text-sm text-gray-400">Loading team status…</div>
      ) : filtered.length === 0 ? (
        <div className="px-5 py-6 text-sm text-gray-400">{merged.length === 0 ? 'No counsellors found.' : 'No match for that search.'}</div>
      ) : (
        <div className="p-3 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 max-h-72 overflow-y-auto">
          {filtered.map((c, i) => {
            const s = c.status
            const state = s?.state ?? 'never'
            return (
              <button
                type="button"
                key={c.id}
                onClick={() => onSelect(c.id)}
                title={s?.blockReason ?? undefined}
                className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-center hover:bg-emerald-50 transition-colors ${selectedId === c.id ? 'bg-emerald-50 ring-1 ring-emerald-300' : ''}`}
              >
                <span className={`relative h-9 w-9 rounded-full flex items-center justify-center text-[11px] font-bold ring-2 ${STATE_RING[state]} ${AVATAR_BG[i % AVATAR_BG.length]}`}>
                  {initials(c.name)}
                  <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${STATE_DOT[state]}`} />
                </span>
                <span className="text-[11px] font-medium text-gray-700 truncate w-full leading-tight">{c.name.split(' ')[0]}</span>
                <span className="text-[10px] text-gray-400 leading-tight">{s ? timeAgo(s.lastSeenAt) : '—'}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  return <div className="h-80 rounded-2xl border border-dashed bg-white flex flex-col items-center justify-center text-center px-6"><div className="h-12 w-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center"><Users className="w-6 h-6" /></div><h2 className="mt-4 font-bold text-gray-900">Choose a counsellor</h2><p className="mt-1 text-sm text-gray-500 max-w-sm">Pick anyone from the grid above to see their full movement route, individual point times, and live tracked location.</p></div>
}

// Fits the whole route once on load, then — for a live (today) view — smoothly
// pans to the newest point as it arrives instead of re-fitting/re-zooming the
// whole map every poll, the same "follow" behavior Google Maps uses for a
// moving blue dot.
function RouteBounds({ route, follow }: { route: [number, number][]; follow: boolean }) {
  const map = useMap()
  const fitted = useRef(false)
  const prevLength = useRef(0)
  useEffect(() => {
    if (route.length === 0) return
    if (!fitted.current) {
      fitted.current = true
      if (route.length === 1) map.setView(route[0], 16)
      else map.fitBounds(route, { padding: [28, 28] })
    } else if (follow && route.length > prevLength.current) {
      map.panTo(route[route.length - 1], { animate: true })
    }
    prevLength.current = route.length
  }, [map, route, follow])
  return null
}
