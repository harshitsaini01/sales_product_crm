import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi } from '@/lib/api'
import { toast } from 'sonner'
import { Loader2, Trash2, Plus, Star } from 'lucide-react'
import { formatDate } from '@/lib/utils'

type Sub = 'school' | 'ucat' | 'dmat' | 'sat' | 'feedback'

const subs: { id: Sub; label: string }[] = [
  { id: 'school', label: 'School History' },
  { id: 'ucat', label: 'UCAT' },
  { id: 'dmat', label: 'DMAT' },
  { id: 'sat', label: 'SAT' },
  { id: 'feedback', label: 'Counsellor Feedback' },
]

export function StudentAcademicsTab({ studentId }: { studentId: number }) {
  const [sub, setSub] = useState<Sub>('school')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b pb-3">
        {subs.map((s) => (
          <button
            key={s.id}
            onClick={() => setSub(s.id)}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
              sub === s.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground hover:text-foreground'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {sub === 'school' && <SchoolHistoryPanel studentId={studentId} />}
      {sub === 'ucat' && <UcatPanel studentId={studentId} />}
      {sub === 'dmat' && <DmatPanel studentId={studentId} />}
      {sub === 'sat' && <SatPanel studentId={studentId} />}
      {sub === 'feedback' && <FeedbackPanel studentId={studentId} />}
    </div>
  )
}

// ─── School History ─────────────────────────────────────────────────────────

interface SchoolRow {
  id: number
  level?: string | null
  schoolName?: string | null
  board?: string | null
  passingYear?: number | null
  percentage?: string | null
  stream?: string | null
  city?: string | null
  country?: string | null
}

const emptySchool = {
  level: '10th',
  schoolName: '',
  board: '',
  passingYear: '',
  percentage: '',
  stream: '',
  city: '',
  country: '',
}

function SchoolHistoryPanel({ studentId }: { studentId: number }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState(emptySchool)
  const [editingId, setEditingId] = useState<number | null>(null)

  const { data: rows = [] } = useQuery<SchoolRow[]>({
    queryKey: ['student-school', studentId],
    queryFn: () => studentsApi.schoolHistory(studentId),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['student-school', studentId] })

  const addMut = useMutation({
    mutationFn: () => studentsApi.addSchool(studentId, draft),
    onSuccess: () => {
      toast.success('Added')
      setDraft(emptySchool)
      invalidate()
    },
  })

  const updMut = useMutation({
    mutationFn: () => studentsApi.updateSchool(studentId, editingId!, draft),
    onSuccess: () => {
      toast.success('Updated')
      setDraft(emptySchool)
      setEditingId(null)
      invalidate()
    },
  })

  const delMut = useMutation({
    mutationFn: (rowId: number) => studentsApi.deleteSchool(studentId, rowId),
    onSuccess: () => {
      toast.success('Removed')
      invalidate()
    },
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <select
          value={draft.level}
          onChange={(e) => setDraft({ ...draft, level: e.target.value })}
          className="px-3 py-2 text-sm border rounded-md bg-background"
        >
          <option value="10th">10th</option>
          <option value="12th">12th</option>
          <option value="graduation">Graduation</option>
          <option value="post-graduation">Post-Graduation</option>
          <option value="other">Other</option>
        </select>
        <input
          placeholder="School / Institution"
          value={draft.schoolName}
          onChange={(e) => setDraft({ ...draft, schoolName: e.target.value })}
          className="px-3 py-2 text-sm border rounded-md bg-background"
        />
        <input
          placeholder="Board"
          value={draft.board}
          onChange={(e) => setDraft({ ...draft, board: e.target.value })}
          className="px-3 py-2 text-sm border rounded-md bg-background"
        />
        <input
          placeholder="Passing Year"
          value={draft.passingYear}
          onChange={(e) => setDraft({ ...draft, passingYear: e.target.value })}
          className="px-3 py-2 text-sm border rounded-md bg-background"
        />
        <input
          placeholder="Percentage / GPA"
          value={draft.percentage}
          onChange={(e) => setDraft({ ...draft, percentage: e.target.value })}
          className="px-3 py-2 text-sm border rounded-md bg-background"
        />
        <input
          placeholder="Stream / Subject"
          value={draft.stream}
          onChange={(e) => setDraft({ ...draft, stream: e.target.value })}
          className="px-3 py-2 text-sm border rounded-md bg-background"
        />
        <input
          placeholder="City"
          value={draft.city}
          onChange={(e) => setDraft({ ...draft, city: e.target.value })}
          className="px-3 py-2 text-sm border rounded-md bg-background"
        />
        <input
          placeholder="Country"
          value={draft.country}
          onChange={(e) => setDraft({ ...draft, country: e.target.value })}
          className="px-3 py-2 text-sm border rounded-md bg-background"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => (editingId ? updMut.mutate() : addMut.mutate())}
          disabled={addMut.isPending || updMut.isPending}
          className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2"
        >
          <Plus className="h-3.5 w-3.5" />
          {editingId ? 'Update' : 'Add Education'}
        </button>
        {editingId && (
          <button
            onClick={() => {
              setEditingId(null)
              setDraft(emptySchool)
            }}
            className="px-3 py-1.5 text-xs text-muted-foreground"
          >
            Cancel
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No education history yet.</p>
      ) : (
        <table className="w-full text-sm border-t">
          <thead className="text-xs text-muted-foreground uppercase">
            <tr>
              <th className="text-left py-2 px-2">Level</th>
              <th className="text-left py-2 px-2">School</th>
              <th className="text-left py-2 px-2">Board</th>
              <th className="text-left py-2 px-2">Year</th>
              <th className="text-left py-2 px-2">Score</th>
              <th className="text-left py-2 px-2">Stream</th>
              <th className="text-left py-2 px-2">Location</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-muted/30">
                <td className="py-2 px-2">{r.level}</td>
                <td className="py-2 px-2">{r.schoolName}</td>
                <td className="py-2 px-2">{r.board}</td>
                <td className="py-2 px-2">{r.passingYear}</td>
                <td className="py-2 px-2">{r.percentage}</td>
                <td className="py-2 px-2">{r.stream}</td>
                <td className="py-2 px-2 text-xs text-muted-foreground">
                  {[r.city, r.country].filter(Boolean).join(', ')}
                </td>
                <td className="py-2 px-2 text-right">
                  <button
                    onClick={() => {
                      setEditingId(r.id)
                      setDraft({
                        level: r.level || '10th',
                        schoolName: r.schoolName || '',
                        board: r.board || '',
                        passingYear: r.passingYear ? String(r.passingYear) : '',
                        percentage: r.percentage || '',
                        stream: r.stream || '',
                        city: r.city || '',
                        country: r.country || '',
                      })
                    }}
                    className="text-xs text-blue-600 hover:underline mr-2"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Remove this entry?')) delMut.mutate(r.id)
                    }}
                    className="text-destructive hover:text-destructive/80"
                  >
                    <Trash2 className="h-3.5 w-3.5 inline" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Generic Exam Panel helper ──────────────────────────────────────────────

function ExamPanel<T extends Record<string, string>>({
  fields,
  initial,
  load,
  save,
  remove,
}: {
  fields: { key: keyof T; label: string; type?: string }[]
  initial: T
  load: () => Promise<unknown>
  save: (data: T) => Promise<unknown>
  remove: () => Promise<unknown>
}) {
  const [draft, setDraft] = useState<T>(initial)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let mounted = true
    load().then((row) => {
      if (!mounted) return
      if (row) {
        const r = row as Record<string, unknown>
        const next: Record<string, string> = { ...initial }
        for (const f of fields) {
          const v = r[f.key as string]
          if (v == null) continue
          if (f.type === 'date' && typeof v === 'string') {
            next[f.key as string] = v.slice(0, 10)
          } else {
            next[f.key as string] = String(v)
          }
        }
        setDraft(next as T)
      }
      setLoaded(true)
    })
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSave = async () => {
    setBusy(true)
    try {
      await save(draft)
      toast.success('Saved')
    } catch {
      toast.error('Save failed')
    } finally {
      setBusy(false)
    }
  }

  const onClear = async () => {
    if (!confirm('Clear all values for this exam?')) return
    setBusy(true)
    try {
      await remove()
      setDraft(initial)
      toast.success('Cleared')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {fields.map((f) => (
          <label key={String(f.key)} className="text-xs">
            <span className="block text-muted-foreground mb-1">{f.label}</span>
            <input
              type={f.type || 'text'}
              value={draft[f.key as string] || ''}
              onChange={(e) =>
                setDraft({ ...draft, [f.key]: e.target.value } as T)
              }
              className="w-full px-3 py-2 text-sm border rounded-md bg-background"
            />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={busy}
          className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onClear}
          disabled={busy}
          className="px-3 py-1.5 text-xs text-destructive hover:underline"
        >
          Clear
        </button>
      </div>
    </div>
  )
}

function UcatPanel({ studentId }: { studentId: number }) {
  return (
    <ExamPanel
      fields={[
        { key: 'examDate', label: 'Exam Date', type: 'date' },
        { key: 'totalScore', label: 'Total Score', type: 'number' },
        { key: 'verbalReasoning', label: 'Verbal Reasoning', type: 'number' },
        { key: 'decisionMaking', label: 'Decision Making', type: 'number' },
        { key: 'quantitative', label: 'Quantitative', type: 'number' },
        { key: 'abstractReason', label: 'Abstract Reasoning', type: 'number' },
        { key: 'situational', label: 'Situational Judgement' },
        { key: 'notes', label: 'Notes' },
      ]}
      initial={{
        examDate: '',
        totalScore: '',
        verbalReasoning: '',
        decisionMaking: '',
        quantitative: '',
        abstractReason: '',
        situational: '',
        notes: '',
      }}
      load={() => studentsApi.ucat(studentId)}
      save={(d) => studentsApi.saveUcat(studentId, d)}
      remove={() => studentsApi.deleteUcat(studentId)}
    />
  )
}

function DmatPanel({ studentId }: { studentId: number }) {
  return (
    <ExamPanel
      fields={[
        { key: 'examDate', label: 'Exam Date', type: 'date' },
        { key: 'totalScore', label: 'Total Score', type: 'number' },
        { key: 'physics', label: 'Physics', type: 'number' },
        { key: 'chemistry', label: 'Chemistry', type: 'number' },
        { key: 'biology', label: 'Biology', type: 'number' },
        { key: 'reasoning', label: 'Reasoning', type: 'number' },
        { key: 'notes', label: 'Notes' },
      ]}
      initial={{
        examDate: '',
        totalScore: '',
        physics: '',
        chemistry: '',
        biology: '',
        reasoning: '',
        notes: '',
      }}
      load={() => studentsApi.dmat(studentId)}
      save={(d) => studentsApi.saveDmat(studentId, d)}
      remove={() => studentsApi.deleteDmat(studentId)}
    />
  )
}

function SatPanel({ studentId }: { studentId: number }) {
  return (
    <ExamPanel
      fields={[
        { key: 'examDate', label: 'Exam Date', type: 'date' },
        { key: 'totalScore', label: 'Total Score', type: 'number' },
        { key: 'reading', label: 'Reading', type: 'number' },
        { key: 'writing', label: 'Writing', type: 'number' },
        { key: 'math', label: 'Math', type: 'number' },
        { key: 'essay', label: 'Essay', type: 'number' },
        { key: 'notes', label: 'Notes' },
      ]}
      initial={{
        examDate: '',
        totalScore: '',
        reading: '',
        writing: '',
        math: '',
        essay: '',
        notes: '',
      }}
      load={() => studentsApi.sat(studentId)}
      save={(d) => studentsApi.saveSat(studentId, d)}
      remove={() => studentsApi.deleteSat(studentId)}
    />
  )
}

// ─── Feedback Panel ────────────────────────────────────────────────────────

interface FeedbackRow {
  id: number
  feedback: string
  rating?: number | null
  createdAt: string
  user?: { id: number; name: string } | null
}

function FeedbackPanel({ studentId }: { studentId: number }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [rating, setRating] = useState<number>(0)

  const { data: rows = [] } = useQuery<FeedbackRow[]>({
    queryKey: ['student-feedback', studentId],
    queryFn: () => studentsApi.feedback(studentId),
  })

  const addMut = useMutation({
    mutationFn: () =>
      studentsApi.addFeedback(studentId, {
        feedback: text.trim(),
        rating: rating || undefined,
      }),
    onSuccess: () => {
      toast.success('Feedback added')
      setText('')
      setRating(0)
      qc.invalidateQueries({ queryKey: ['student-feedback', studentId] })
    },
  })

  const delMut = useMutation({
    mutationFn: (fbId: number) => studentsApi.deleteFeedback(studentId, fbId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student-feedback', studentId] })
    },
  })

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write feedback for this student…"
          rows={3}
          className="w-full px-3 py-2 text-sm border rounded-md bg-background resize-none"
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground mr-2">Rating:</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n === rating ? 0 : n)}
                className={`p-0.5 ${n <= rating ? 'text-yellow-500' : 'text-muted-foreground'}`}
              >
                <Star className="h-4 w-4" fill={n <= rating ? 'currentColor' : 'none'} />
              </button>
            ))}
          </div>
          <button
            onClick={() => addMut.mutate()}
            disabled={!text.trim() || addMut.isPending}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            Add Feedback
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No feedback yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="p-3 bg-muted/30 rounded-md text-sm group">
              <p className="whitespace-pre-wrap">{r.feedback}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span>{r.user?.name || `User #${r.id}`}</span>
                <span>{formatDate(r.createdAt)}</span>
                {!!r.rating && (
                  <span className="text-yellow-600">
                    {'★'.repeat(r.rating)}
                    {'☆'.repeat(5 - r.rating)}
                  </span>
                )}
                <button
                  onClick={() => delMut.mutate(r.id)}
                  className="opacity-0 group-hover:opacity-100 ml-auto text-destructive hover:text-destructive/80"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
