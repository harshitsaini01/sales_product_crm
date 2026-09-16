import { useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { autoDialerApi, b2bApi, usersApi, type B2bContact, type AutoDialerRecording } from '@/lib/api'
import { toast } from 'sonner'
import { X, ChevronLeft, ChevronRight, Upload, Play, Pause, Loader2, Search } from 'lucide-react'

interface Props {
  onClose: () => void
}

type Step = 'type' | 'contacts' | 'recording' | 'details' | 'assign' | 'review'

const STEPS: { id: Step; label: string }[] = [
  { id: 'type', label: 'Type' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'recording', label: 'Recording' },
  { id: 'details', label: 'Details' },
  { id: 'assign', label: 'Assign' },
  { id: 'review', label: 'Review' },
]

const GAP_OPTIONS = [15, 30, 60, 120, 300]

export function NewCampaignWizard({ onClose }: Props) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>('type')
  const [type, setType] = useState<'B2B' | 'B2C'>('B2B')
  const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set())
  const [recordingId, setRecordingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [callGapSec, setCallGapSec] = useState(30)
  const [counsellorIds, setCounsellorIds] = useState<Set<number>>(new Set())

  const stepIdx = STEPS.findIndex((s) => s.id === step)
  const canNext = (() => {
    if (step === 'type') return type === 'B2B'
    if (step === 'contacts') return selectedContactIds.size > 0
    if (step === 'recording') return recordingId !== null
    if (step === 'details') return name.trim().length > 0
    if (step === 'assign') return counsellorIds.size > 0
    return true
  })()

  const createMut = useMutation({
    mutationFn: async () => {
      const camp = await autoDialerApi.create({ name: name.trim(), description, type, recordingId: recordingId!, callGapSec })
      await autoDialerApi.attachContacts(camp.id, Array.from(selectedContactIds))
      await autoDialerApi.assign(camp.id, Array.from(counsellorIds))
      await autoDialerApi.start(camp.id)
      return camp
    },
    onSuccess: (camp) => {
      toast.success('Campaign launched')
      qc.invalidateQueries({ queryKey: ['auto-dialer'] })
      onClose()
      navigate({ to: '/app/auto-dialer/$id', params: { id: String(camp.id) } })
    },
    onError: () => toast.error('Failed to create campaign'),
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold">New Auto-Dialer Campaign</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        {/* Stepper */}
        <div className="px-4 pt-4 pb-2 flex items-center gap-1 overflow-x-auto">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1 shrink-0">
              <div className={`px-2 py-1 rounded-full text-xs font-medium ${i === stepIdx ? 'bg-primary text-primary-foreground' : i < stepIdx ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
                {i + 1}. {s.label}
              </div>
              {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {step === 'type' && <StepType type={type} setType={setType} />}
          {step === 'contacts' && <StepContacts selected={selectedContactIds} setSelected={setSelectedContactIds} />}
          {step === 'recording' && <StepRecording recordingId={recordingId} setRecordingId={setRecordingId} />}
          {step === 'details' && <StepDetails name={name} setName={setName} description={description} setDescription={setDescription} callGapSec={callGapSec} setCallGapSec={setCallGapSec} />}
          {step === 'assign' && <StepAssign counsellorIds={counsellorIds} setCounsellorIds={setCounsellorIds} totalContacts={selectedContactIds.size} />}
          {step === 'review' && <StepReview {...{ type, name, description, callGapSec, recordingId, contactCount: selectedContactIds.size, counsellorCount: counsellorIds.size }} />}
        </div>

        <div className="p-4 border-t flex justify-between items-center">
          <button
            onClick={() => setStep(STEPS[Math.max(0, stepIdx - 1)].id)}
            disabled={stepIdx === 0}
            className="px-3 py-1.5 rounded border text-sm disabled:opacity-40 inline-flex items-center gap-1"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
          {step === 'review' ? (
            <button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending}
              className="px-4 py-1.5 rounded bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2"
            >
              {createMut.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Launch Campaign
            </button>
          ) : (
            <button
              onClick={() => setStep(STEPS[stepIdx + 1].id)}
              disabled={!canNext}
              className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm disabled:opacity-40 inline-flex items-center gap-1"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Step 1: Type ─────────────────────────────────────────────────────────
function StepType({ type, setType }: { type: 'B2B' | 'B2C'; setType: (t: 'B2B' | 'B2C') => void }) {
  return (
    <div className="space-y-3">
      <h3 className="font-medium text-sm">Campaign type</h3>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setType('B2B')}
          className={`p-4 rounded-lg border-2 text-left ${type === 'B2B' ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}
        >
          <div className="font-semibold">B2B</div>
          <p className="text-xs text-muted-foreground mt-1">Bulk outbound to B2B contact bank</p>
        </button>
        <button
          disabled
          className="p-4 rounded-lg border-2 text-left opacity-50 cursor-not-allowed"
        >
          <div className="font-semibold">B2C <span className="text-xs font-normal">(coming soon)</span></div>
          <p className="text-xs text-muted-foreground mt-1">Reach individual leads</p>
        </button>
      </div>
    </div>
  )
}

// ─── Step 2: Contacts ─────────────────────────────────────────────────────
function StepContacts({ selected, setSelected }: { selected: Set<number>; setSelected: (s: Set<number>) => void }) {
  const [search, setSearch] = useState('')
  const [state, setState] = useState('')
  const [page, setPage] = useState(1)

  const statesQ = useQuery({ queryKey: ['b2b', 'states'], queryFn: b2bApi.states })
  const listQ = useQuery({
    queryKey: ['b2b', 'contacts', { search, state, page, scope: 'wizard' }],
    queryFn: () => b2bApi.list({
      page: String(page),
      limit: '100',
      ...(search ? { search } : {}),
      ...(state ? { state } : {}),
    }),
  })

  const toggle = (id: number) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelected(next)
  }
  const selectAllVisible = () => {
    const next = new Set(selected)
    for (const c of listQ.data?.data || []) next.add(c.id)
    setSelected(next)
  }
  const clearAll = () => setSelected(new Set())

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">Select contacts <span className="text-muted-foreground">({selected.size} selected)</span></h3>
        <div className="flex gap-2 text-xs">
          <button onClick={selectAllVisible} className="text-primary hover:underline">Select page</button>
          <button onClick={clearAll} className="text-destructive hover:underline">Clear</button>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search name/phone/email"
            className="w-full pl-9 pr-3 py-1.5 text-sm rounded border bg-background"
          />
        </div>
        <select value={state} onChange={(e) => { setState(e.target.value); setPage(1) }} className="px-2 py-1.5 text-sm rounded border bg-background">
          <option value="">All states</option>
          {(statesQ.data || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="border rounded-md max-h-[40vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 sticky top-0">
            <tr className="text-left">
              <th className="px-2 py-1.5 w-10"></th>
              <th className="px-2 py-1.5">Name</th>
              <th className="px-2 py-1.5">Phone</th>
              <th className="px-2 py-1.5">State</th>
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading ? (
              <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : (listQ.data?.data || []).map((c: B2bContact) => (
              <tr key={c.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => toggle(c.id)}>
                <td className="px-2 py-1.5">
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                </td>
                <td className="px-2 py-1.5">{c.name}</td>
                <td className="px-2 py-1.5 font-mono text-xs">{c.phone}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{c.state || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {listQ.data && listQ.data.totalPages > 1 && (
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">{listQ.data.total} total · page {page}/{listQ.data.totalPages}</span>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-2 py-0.5 rounded border disabled:opacity-40">Prev</button>
            <button disabled={page >= listQ.data.totalPages} onClick={() => setPage((p) => p + 1)} className="px-2 py-0.5 rounded border disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Step 3: Recording ────────────────────────────────────────────────────
function StepRecording({ recordingId, setRecordingId }: { recordingId: number | null; setRecordingId: (n: number | null) => void }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [recName, setRecName] = useState('')
  const [playingId, setPlayingId] = useState<number | null>(null)

  const listQ = useQuery({ queryKey: ['auto-dialer', 'recordings'], queryFn: autoDialerApi.recordings })

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const audio = new Audio(URL.createObjectURL(file))
      const durationSec = await new Promise<number>((res) => {
        audio.addEventListener('loadedmetadata', () => res(Math.round(audio.duration)))
        audio.addEventListener('error', () => res(0))
      })
      return autoDialerApi.uploadRecording(file, recName || file.name, durationSec)
    },
    onSuccess: (rec) => {
      toast.success(`Uploaded ${rec.name}`)
      setRecordingId(rec.id)
      setRecName('')
      qc.invalidateQueries({ queryKey: ['auto-dialer', 'recordings'] })
    },
    onError: () => toast.error('Upload failed'),
  })

  const togglePlay = (rec: AutoDialerRecording) => {
    if (!audioRef.current) return
    if (playingId === rec.id) {
      audioRef.current.pause()
      setPlayingId(null)
    } else {
      audioRef.current.src = autoDialerApi.recordingStreamUrl(rec.id)
      audioRef.current.play().then(() => setPlayingId(rec.id)).catch(() => toast.error('Playback failed'))
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-sm">Select recording</h3>

      <audio ref={audioRef} onEnded={() => setPlayingId(null)} />

      {/* Upload */}
      <div className="border-2 border-dashed rounded p-3 space-y-2">
        <div className="flex gap-2">
          <input
            value={recName}
            onChange={(e) => setRecName(e.target.value)}
            placeholder="Recording name (optional)"
            className="flex-1 px-2 py-1.5 text-sm rounded border bg-background"
          />
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMut.mutate(f); if (fileRef.current) fileRef.current.value = '' }}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadMut.isPending}
            className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground inline-flex items-center gap-1"
          >
            {uploadMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            Upload
          </button>
        </div>
        <p className="text-xs text-muted-foreground">MP3 / M4A / WAV — max 25 MB</p>
      </div>

      {/* Library */}
      <div className="border rounded max-h-[40vh] overflow-y-auto">
        {listQ.isLoading ? (
          <div className="p-6 text-center text-muted-foreground text-sm">Loading…</div>
        ) : (listQ.data || []).length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">No recordings yet</div>
        ) : (listQ.data || []).map((rec) => (
          <label
            key={rec.id}
            className={`flex items-center gap-3 p-3 border-b cursor-pointer hover:bg-muted/40 ${recordingId === rec.id ? 'bg-primary/5' : ''}`}
          >
            <input
              type="radio"
              checked={recordingId === rec.id}
              onChange={() => setRecordingId(rec.id)}
            />
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); togglePlay(rec) }}
              className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20"
            >
              {playingId === rec.id ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </button>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{rec.name}</div>
              <div className="text-xs text-muted-foreground">
                {rec.durationSec ? `${rec.durationSec}s` : 'Unknown duration'} · {(rec.sizeBytes / 1024).toFixed(1)} KB
              </div>
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}

// ─── Step 4: Details ──────────────────────────────────────────────────────
function StepDetails({
  name, setName, description, setDescription, callGapSec, setCallGapSec,
}: {
  name: string; setName: (s: string) => void
  description: string; setDescription: (s: string) => void
  callGapSec: number; setCallGapSec: (n: number) => void
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium">Campaign name *</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Q2 outreach – Maharashtra"
          className="mt-1 w-full px-3 py-2 text-sm rounded border bg-background"
        />
      </div>
      <div>
        <label className="text-sm font-medium">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="mt-1 w-full px-3 py-2 text-sm rounded border bg-background resize-none"
        />
      </div>
      <div>
        <label className="text-sm font-medium">Gap between calls</label>
        <p className="text-xs text-muted-foreground mb-2">Required to reduce spam-detection risk on counsellor SIMs.</p>
        <div className="flex gap-2 flex-wrap">
          {GAP_OPTIONS.map((g) => (
            <button
              key={g}
              onClick={() => setCallGapSec(g)}
              className={`px-3 py-1.5 rounded border text-sm ${callGapSec === g ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'}`}
            >
              {g < 60 ? `${g}s` : `${g / 60}m`}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Step 5: Assign ───────────────────────────────────────────────────────
function StepAssign({
  counsellorIds, setCounsellorIds, totalContacts,
}: {
  counsellorIds: Set<number>; setCounsellorIds: (s: Set<number>) => void
  totalContacts: number
}) {
  const counsellorsQ = useQuery({
    queryKey: ['users', 'counsellors'],
    queryFn: usersApi.counsellors,
  })

  const counsellors = (counsellorsQ.data as Array<{ id: number; name: string; mobile?: string }> | undefined) || []
  const perPerson = counsellorIds.size > 0 ? Math.floor(totalContacts / counsellorIds.size) : 0
  const remainder = counsellorIds.size > 0 ? totalContacts % counsellorIds.size : 0

  const toggle = (id: number) => {
    const next = new Set(counsellorIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    setCounsellorIds(next)
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-medium text-sm">Assign counsellors</h3>
        <p className="text-xs text-muted-foreground">{totalContacts} contacts will be split round-robin.</p>
      </div>

      {counsellorIds.size > 0 && (
        <div className="rounded bg-primary/5 border border-primary/20 p-2 text-xs">
          ≈ {perPerson} contacts each {remainder > 0 && `(${remainder} counsellors get one extra)`}
        </div>
      )}

      <div className="border rounded max-h-[40vh] overflow-y-auto">
        {counsellors.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">No counsellors found</div>
        ) : counsellors.map((u) => (
          <label key={u.id} className="flex items-center gap-3 p-2 border-b cursor-pointer hover:bg-muted/40">
            <input type="checkbox" checked={counsellorIds.has(u.id)} onChange={() => toggle(u.id)} />
            <div className="flex-1">
              <div className="text-sm font-medium">{u.name}</div>
              {u.mobile && <div className="text-xs text-muted-foreground">{u.mobile}</div>}
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}

// ─── Step 6: Review ───────────────────────────────────────────────────────
function StepReview({
  type, name, description, callGapSec, recordingId, contactCount, counsellorCount,
}: {
  type: 'B2B' | 'B2C'; name: string; description: string; callGapSec: number
  recordingId: number | null; contactCount: number; counsellorCount: number
}) {
  const recQ = useQuery({
    queryKey: ['auto-dialer', 'recordings'],
    queryFn: autoDialerApi.recordings,
  })
  const rec = useMemo(() => (recQ.data || []).find((r) => r.id === recordingId), [recQ.data, recordingId])

  return (
    <div className="space-y-3 text-sm">
      <h3 className="font-medium">Review & launch</h3>
      <dl className="grid grid-cols-2 gap-y-2 gap-x-4">
        <dt className="text-muted-foreground">Type</dt><dd>{type}</dd>
        <dt className="text-muted-foreground">Name</dt><dd className="font-medium">{name || '—'}</dd>
        <dt className="text-muted-foreground">Description</dt><dd>{description || '—'}</dd>
        <dt className="text-muted-foreground">Recording</dt><dd>{rec?.name || '—'}</dd>
        <dt className="text-muted-foreground">Call gap</dt><dd>{callGapSec}s</dd>
        <dt className="text-muted-foreground">Contacts</dt><dd>{contactCount}</dd>
        <dt className="text-muted-foreground">Counsellors</dt><dd>{counsellorCount}</dd>
        <dt className="text-muted-foreground">Per counsellor</dt>
        <dd>{counsellorCount > 0 ? `~ ${Math.floor(contactCount / counsellorCount)}` : '—'}</dd>
      </dl>
      <div className="rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 text-xs text-amber-900 dark:text-amber-200">
        Launching marks the campaign <strong>active</strong> and assigned counsellors can immediately start dialing from the app.
      </div>
    </div>
  )
}
