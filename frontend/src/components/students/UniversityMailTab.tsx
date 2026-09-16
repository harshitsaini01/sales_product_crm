import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, universityMailApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { toast } from 'sonner'
import {
  Send, Loader2, FileText, CheckCircle2, Eye,
  Clock, ExternalLink, RefreshCw, MailCheck, AlertCircle,
} from 'lucide-react'
import { RichTextEditor } from '@/components/common/RichTextEditor'
import { formatDateTime, getFileUrl } from '@/lib/utils'

interface DocumentItem {
  id: number
  title: string
  filename: string
  filepath: string
  createdAt: string
}

interface SignatureItem {
  id: number
  title: string
  content: string
  isDefault?: number
}

interface UniversityMailRecord {
  id: number
  toEmail: string
  cc?: string
  greeting?: string
  recipientName?: string
  senderName?: string
  subject: string
  body: string
  attachedDocs?: string[]
  sentBy?: { id: number; name: string; email: string }
  isOpened: boolean
  openCount: number
  firstOpenedAt?: string
  lastOpenedAt?: string
  createdAt: string
}

const DEFAULT_MAIL_BODY = `Greetings from Tutelage Study,
Hope you are doing well. Kindly pursue the applicant information attached and eligibility of the applicant to issue offer letter. Feel free to contact us for further information. Expecting to listen from you at the earliest.
With Regards,`

export function UniversityMailTab({ studentId }: { studentId: number }) {
  const qc = useQueryClient()
  const { user } = useAuthStore()

  // Form State
  const [toEmail, setToEmail] = useState('')
  const [cc, setCc] = useState('')
  const [greeting, setGreeting] = useState('Dear')
  const [recipientName, setRecipientName] = useState('')
  const [mailBody, setMailBody] = useState(DEFAULT_MAIL_BODY)
  const [program, setProgram] = useState('')
  const [universityName, setUniversityName] = useState('')
  const [senderName, setSenderName] = useState(user?.name || 'Aman Ahlawat')
  const [selectedSignatureId, setSelectedSignatureId] = useState<number | null>(null)
  const [selectedDocs, setSelectedDocs] = useState<number[]>([])
  const [previewMail, setPreviewMail] = useState<UniversityMailRecord | null>(null)

  // Fetch Signatures from Communication -> Signatures
  const { data: signatures = [] } = useQuery<SignatureItem[]>({
    queryKey: ['communication-signatures'],
    queryFn: () => api.get('/communication/signatures').then((r) => r.data),
  })

  useEffect(() => {
    if (signatures.length > 0 && selectedSignatureId === null) {
      const defaultSig = signatures.find((s) => s.isDefault === 1) || signatures[0]
      if (defaultSig) {
        setSelectedSignatureId(Number(defaultSig.id))
        setSenderName(defaultSig.title)
      }
    }
  }, [signatures])

  // Fetch Student Info for pre-filling program & university
  const { data: studentInfo } = useQuery({
    queryKey: ['student-mail-info', studentId],
    queryFn: () => api.get(`/students/${studentId}`).then((r) => r.data),
  })

  useEffect(() => {
    if (studentInfo) {
      if (!program) setProgram(studentInfo.course || studentInfo.intrestedCourse || '')
      if (!universityName) setUniversityName(studentInfo.intrestedUniversity || '')
    }
  }, [studentInfo])

  // Fetch Student Documents
  const { data: documents = [], isLoading: loadingDocs } = useQuery<DocumentItem[]>({
    queryKey: ['student-documents', studentId],
    queryFn: () => api.get(`/students/${studentId}/documents`).then((r) => r.data),
  })

  // Fetch University Mail History
  const {
    data: mailHistory = [],
    isLoading: loadingHistory,
    refetch: refetchHistory,
  } = useQuery<UniversityMailRecord[]>({
    queryKey: ['university-mail-history', studentId],
    queryFn: () => universityMailApi.getHistory(studentId),
  })

  // Toggle select all documents
  const toggleSelectAllDocs = () => {
    if (selectedDocs.length === documents.length) {
      setSelectedDocs([])
    } else {
      setSelectedDocs(documents.map((d) => Number(d.id)))
    }
  }

  // Toggle single document
  const toggleDoc = (docId: number) => {
    setSelectedDocs((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    )
  }

  // Send Application Mutation
  const sendMutation = useMutation({
    mutationFn: (payload: {
      toEmail: string
      cc?: string
      greeting?: string
      recipientName?: string
      senderName?: string
      signatureId?: number | null
      program?: string
      universityName?: string
      body: string
      selectedDocIds: number[]
    }) => universityMailApi.send(studentId, payload),
    onSuccess: () => {
      toast.success('Application email sent successfully to university!')
      setToEmail('')
      setCc('')
      setRecipientName('')
      setSelectedDocs([])
      qc.invalidateQueries({ queryKey: ['university-mail-history', studentId] })
      qc.invalidateQueries({ queryKey: ['university-mails-all'] })
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to send application email')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!toEmail.trim()) {
      return toast.error('Send to Email is required')
    }
    sendMutation.mutate({
      toEmail: toEmail.trim(),
      cc: cc.trim(),
      greeting: greeting.trim(),
      recipientName: recipientName.trim(),
      senderName: senderName.trim(),
      signatureId: selectedSignatureId,
      program: program.trim(),
      universityName: universityName.trim(),
      body: mailBody,
      selectedDocIds: selectedDocs,
    })
  }

  return (
    <div className="space-y-8">
      {/* Form Container (Matches UI Mockup) */}
      <div className="bg-card border rounded-lg p-6 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b pb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" /> Send Application to University
          </h2>
          <span className="text-xs text-muted-foreground">
            Mail with attached documents and open tracking
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Send to & CC */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Send to <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                placeholder="Enter Email Id"
                className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                CC
              </label>
              <input
                type="email"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="Enter Email Id"
                className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Greeting & Recipient Name */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Greeting
              </label>
              <input
                type="text"
                value={greeting}
                onChange={(e) => setGreeting(e.target.value)}
                placeholder="Dear"
                className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Recipient Name
              </label>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="recipient Name"
                className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Program & University Name */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Program / Course
              </label>
              <input
                type="text"
                value={program}
                onChange={(e) => setProgram(e.target.value)}
                placeholder="e.g. M.Pharm. Pharmaceutics"
                className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Target University
              </label>
              <input
                type="text"
                value={universityName}
                onChange={(e) => setUniversityName(e.target.value)}
                placeholder="e.g. Gandhi Institute of Technology and Management"
                className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Mail Body Rich Text Editor */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Mail Body
            </label>
            <RichTextEditor
              value={mailBody}
              onChange={setMailBody}
              placeholder="Greetings from Tutelage Study..."
              minHeight="140px"
            />
          </div>

          {/* Sender Signature Select */}
          <div className="w-full md:w-1/2">
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Sender Signature
            </label>
            <select
              value={selectedSignatureId !== null ? selectedSignatureId : ''}
              onChange={(e) => {
                const val = e.target.value
                if (val) {
                  const id = Number(val)
                  setSelectedSignatureId(id)
                  const found = signatures.find((s) => Number(s.id) === id)
                  if (found) setSenderName(found.title)
                } else {
                  setSelectedSignatureId(null)
                }
              }}
              className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {signatures.length > 0 ? (
                signatures.map((sig) => (
                  <option key={sig.id} value={Number(sig.id)}>
                    {sig.title} {sig.isDefault ? '(Default)' : ''}
                  </option>
                ))
              ) : (
                <>
                  <option value="">{user?.name || 'Aman Ahlawat'}</option>
                  <option value="">Tutelage Study Team</option>
                  <option value="">Admissions Department</option>
                </>
              )}
            </select>
          </div>

          <hr className="my-4 border-muted" />

          {/* Documents Selection Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground">
                Select Student Documents to Attach
              </label>
              {documents.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {selectedDocs.length} of {documents.length} selected
                </span>
              )}
            </div>

            <div className="border rounded-md overflow-hidden bg-background">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs font-medium text-muted-foreground border-b">
                  <tr>
                    <th className="p-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={documents.length > 0 && selectedDocs.length === documents.length}
                        onChange={toggleSelectAllDocs}
                        disabled={documents.length === 0}
                        className="rounded border-gray-300 focus:ring-primary h-4 w-4"
                      />
                    </th>
                    <th className="p-3 font-semibold text-foreground">Name</th>
                    <th className="p-3 text-right font-semibold text-foreground">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingDocs ? (
                    <tr>
                      <td colSpan={3} className="p-6 text-center text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading documents...
                      </td>
                    </tr>
                  ) : documents.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-8 text-center text-muted-foreground">
                        No Data Found
                      </td>
                    </tr>
                  ) : (
                    documents.map((doc) => {
                      const docId = Number(doc.id)
                      const isChecked = selectedDocs.includes(docId)
                      return (
                        <tr
                          key={doc.id}
                          className={`hover:bg-muted/30 transition-colors ${
                            isChecked ? 'bg-primary/5' : ''
                          }`}
                        >
                          <td className="p-3 text-center">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleDoc(docId)}
                              className="rounded border-gray-300 focus:ring-primary h-4 w-4"
                            />
                          </td>
                          <td className="p-3 font-medium flex items-center gap-2">
                            <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />
                            <span>{doc.title || doc.filename}</span>
                          </td>
                          <td className="p-3 text-right">
                            <a
                              href={getFileUrl(doc.filepath)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <ExternalLink className="h-3 w-3" /> View
                            </a>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={sendMutation.isPending}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {sendMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Sending Mail...
                </>
              ) : (
                'Send'
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Sent Mail History & Tracking Records */}
      <div className="bg-card border rounded-lg p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <MailCheck className="h-4 w-4 text-green-600" /> Application Email Records & Tracking
            </h3>
            <p className="text-xs text-muted-foreground">
              History of university application emails and recipient open activity.
            </p>
          </div>
          <button
            onClick={() => refetchHistory()}
            className="p-1.5 text-xs text-muted-foreground hover:text-foreground border rounded-md hover:bg-muted transition-colors flex items-center gap-1"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {loadingHistory ? (
          <div className="py-8 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Loading records...
          </div>
        ) : mailHistory.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            No application emails sent yet for this student.
          </div>
        ) : (
          <div className="border rounded-md overflow-hidden bg-background">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-xs font-medium text-muted-foreground border-b">
                <tr>
                  <th className="p-3 font-semibold text-foreground">Recipient / CC</th>
                  <th className="p-3 font-semibold text-foreground">Attachments</th>
                  <th className="p-3 font-semibold text-foreground">Sent Date</th>
                  <th className="p-3 font-semibold text-foreground">Open Status</th>
                  <th className="p-3 text-right font-semibold text-foreground">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {mailHistory.map((m) => (
                  <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3">
                      <div className="font-medium text-foreground">{m.toEmail}</div>
                      {m.cc && <div className="text-xs text-muted-foreground">CC: {m.cc}</div>}
                      {m.recipientName && (
                        <div className="text-xs text-muted-foreground">Name: {m.recipientName}</div>
                      )}
                    </td>
                    <td className="p-3">
                      {m.attachedDocs && m.attachedDocs.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {m.attachedDocs.map((docName, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 text-xs bg-muted border rounded-full text-muted-foreground flex items-center gap-1"
                            >
                              <FileText className="h-3 w-3 text-blue-500" /> {docName}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No attachments</span>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDateTime(m.createdAt)}
                      {m.sentBy?.name && (
                        <div className="text-muted-foreground">By: {m.sentBy.name}</div>
                      )}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {m.isOpened ? (
                        <div className="space-y-0.5">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs rounded-full bg-green-50 text-green-700 font-medium border border-green-200">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Opened ({m.openCount}x)
                          </span>
                          {m.lastOpenedAt && (
                            <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Clock className="h-3 w-3" /> {formatDateTime(m.lastOpenedAt)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600 font-medium border border-gray-200">
                          <AlertCircle className="h-3.5 w-3.5" /> Unopened
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => setPreviewMail(m)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border rounded-md hover:bg-muted transition-colors"
                      >
                        <Eye className="h-3.5 w-3.5" /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Preview Sent Email Modal */}
      {previewMail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card border rounded-lg max-w-xl w-full p-6 space-y-4 shadow-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-semibold text-lg">Application Mail Preview</h3>
              <button
                onClick={() => setPreviewMail(null)}
                className="text-muted-foreground hover:text-foreground text-sm px-2 py-1 rounded-md"
              >
                ✕ Close
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <strong>To:</strong> {previewMail.toEmail}
              </div>
              {previewMail.cc && (
                <div>
                  <strong>CC:</strong> {previewMail.cc}
                </div>
              )}
              {previewMail.recipientName && (
                <div>
                  <strong>Recipient Name:</strong> {previewMail.recipientName}
                </div>
              )}
              <div>
                <strong>Subject:</strong> {previewMail.subject}
              </div>
              <div className="pt-2">
                <strong>Open Status:</strong>{' '}
                {previewMail.isOpened ? (
                  <span className="text-green-600 font-medium">
                    Opened {previewMail.openCount} time(s) (Last opened: {formatDateTime(previewMail.lastOpenedAt)})
                  </span>
                ) : (
                  <span className="text-gray-500 font-medium">Unopened</span>
                )}
              </div>
              <hr className="my-2" />
              <div>
                <strong className="block mb-1">Mail Content:</strong>
                <div
                  className="p-4 border rounded-md bg-muted/20 text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: previewMail.body }}
                />
              </div>
              {previewMail.attachedDocs && previewMail.attachedDocs.length > 0 && (
                <div>
                  <strong className="block mb-1">Attached Documents:</strong>
                  <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                    {previewMail.attachedDocs.map((doc, i) => (
                      <li key={i}>{doc}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
