import { useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, financialApi } from '@/lib/api'
import { formatDate, maskPhone } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { toast } from 'sonner'
import { Loader2, Phone, Mail, MapPin, GraduationCap, Banknote, FileDown, Award } from 'lucide-react'
import { StudentAcademicsTab } from '@/components/students/StudentAcademicsTab'
import { UniversityMailTab } from '@/components/students/UniversityMailTab'
import { Send as SendIcon } from 'lucide-react'

type Tab = 'info' | 'academics' | 'fees' | 'university-mail'

export function StudentDetail() {
  const { studentId } = useParams({ strict: false }) as { studentId: string }
  const qc = useQueryClient()
  const { isAdmin } = useAuthStore()
  const canRevealPhone = useAuthStore((s) => s.canRevealPhone())
  const [tab, setTab] = useState<Tab>('info')

  const { data: student, isLoading } = useQuery({
    queryKey: ['student', Number(studentId)],
    queryFn: () => api.get(`/students/${studentId}`).then((r) => r.data),
  })

  if (isLoading) return <div className="p-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
  if (!student) return <div className="p-8 text-center text-muted-foreground">Student not found</div>

  const tabs = [
    { id: 'info' as Tab, label: 'Info', icon: <GraduationCap className="h-3.5 w-3.5" /> },
    { id: 'academics' as Tab, label: 'Academics', icon: <Award className="h-3.5 w-3.5" /> },
    { id: 'university-mail' as Tab, label: 'University Mail', icon: <SendIcon className="h-3.5 w-3.5" /> },
    { id: 'fees' as Tab, label: 'Fees', icon: <Banknote className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-card border rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-bold">{student.name}</h1>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              {student.mobile && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{maskPhone(student.mobile as string, canRevealPhone)}</span>}
              {student.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{student.email}</span>}
              {student.country && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{[student.city, student.country].filter(Boolean).join(', ')}</span>}
            </div>
          </div>
          <div className="text-right text-sm">
            {student.course && <div className="font-medium">{student.course}</div>}
            {student.balanceFees != null && (
              <div className={`mt-1 font-semibold ${student.balanceFees > 0 ? 'text-red-600' : 'text-green-600'}`}>
                Balance: ₹{student.balanceFees.toLocaleString()}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="flex border-b overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${tab === t.id ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === 'info' && <InfoTab student={student} qc={qc} />}
          {tab === 'academics' && <StudentAcademicsTab studentId={student.id} />}
          {tab === 'university-mail' && <UniversityMailTab studentId={Number(student.id)} />}
          {tab === 'fees' && <FeesTab studentId={student.id} isAdmin={isAdmin()} />}
        </div>
      </div>
    </div>
  )
}

// ─── Info Tab ─────────────────────────────────────────────────────────────────
function InfoTab({ student, qc }: { student: Record<string, unknown>; qc: ReturnType<typeof useQueryClient> }) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    course: (student.course as string) || '',
    totalFees: String(student.totalFees || ''),
    totalDepositFees: String(student.totalDepositFees || ''),
    balanceFees: String(student.balanceFees || ''),
    highestQualification: (student.highestQualification as string) || '',
    neetscore: (student.neetscore as string) || '',
    persuing_country: (student.persuing_country as string) || '',
    preferredDestination: (student.preferredDestination as string) || '',
    englishExamType: (student.englishExamType as string) || '',
    overallScore: String(student.overallScore || ''),
  })

  const save = async () => {
    setSaving(true)
    try {
      await api.patch(`/students/${student.id}/personal`, {
        course: form.course,
        totalFees: form.totalFees ? Number(form.totalFees) : null,
        totalDepositFees: form.totalDepositFees ? Number(form.totalDepositFees) : null,
        balanceFees: form.balanceFees ? Number(form.balanceFees) : null,
      })
      await api.patch(`/students/${student.id}/education`, {
        highestQualification: form.highestQualification,
        neetscore: form.neetscore,
        persuing_country: form.persuing_country,
        preferredDestination: form.preferredDestination,
        englishExamType: form.englishExamType,
        overallScore: form.overallScore ? Number(form.overallScore) : null,
      })
      qc.invalidateQueries({ queryKey: ['student', Number(student.id)] })
      toast.success('Saved')
    } catch {
      toast.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const F = ({ label, field, type = 'text' }: { label: string; field: string; type?: string }) => (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input type={type} value={(form as Record<string, string>)[field]}
        onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
        className="w-full mt-1 px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <F label="Course" field="course" />
        <F label="Total Fees (₹)" field="totalFees" type="number" />
        <F label="Deposit Paid (₹)" field="totalDepositFees" type="number" />
        <F label="Balance (₹)" field="balanceFees" type="number" />
        <F label="Highest Qualification" field="highestQualification" />
        <F label="NEET Score" field="neetscore" />
        <F label="Pursuing Country" field="persuing_country" />
        <F label="Preferred Destination" field="preferredDestination" />
        <F label="English Exam" field="englishExamType" />
        <F label="Overall Score" field="overallScore" type="number" />
      </div>
      <button onClick={save} disabled={saving}
        className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
      >
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
      </button>
    </div>
  )
}

// ─── Fees Tab ─────────────────────────────────────────────────────────────────
function FeesTab({ studentId }: { studentId: number; isAdmin: boolean }) {
  const { data: invoices = [] } = useQuery({
    queryKey: ['student-invoices', studentId],
    queryFn: () => api.get(`/students/${studentId}/invoices`).then((r) => r.data),
  })

  async function downloadPdf(invoiceId: number, invoiceNo: string) {
    try {
      const blob = await financialApi.invoicePdf(invoiceId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `invoice-${invoiceNo}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download PDF')
    }
  }

  return (
    <div className="space-y-3">
      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invoices yet</p>
      ) : (
        invoices.map((inv: Record<string, unknown>) => (
          <div key={inv.id as number} className="p-4 border rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{inv.invoiceNo as string}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{inv.description as string}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="font-semibold">₹{Number(inv.amount).toLocaleString()}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${inv.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {inv.status as string}
                  </span>
                </div>
                <button
                  onClick={() => downloadPdf(inv.id as number, inv.invoiceNo as string)}
                  className="p-2 rounded-md hover:bg-muted text-muted-foreground hover:text-primary"
                  title="Download PDF"
                >
                  <FileDown className="h-4 w-4" />
                </button>
              </div>
            </div>
            {Array.isArray(inv.payments) && inv.payments.length > 0 && (
              <div className="mt-3 space-y-1 border-t pt-2">
                {inv.payments.map((p: Record<string, unknown>) => (
                  <div key={p.id as number} className="flex justify-between text-xs text-muted-foreground">
                    <span>{formatDate(p.paidAt as string)} · {p.mode as string}</span>
                    <span>₹{Number(p.amount).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}
