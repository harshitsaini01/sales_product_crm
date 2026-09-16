import { useState, useEffect } from 'react'
import { Send, Users, Mail, FileText, Settings, LayoutTemplate } from 'lucide-react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { communicationApi, leadConfigApi } from '@/lib/api'
import { toast } from 'sonner'

interface Template {
  id: number
  title: string
  subject: string
  body: string
}

interface Signature {
  id: number
  title: string
  content: string
  isDefault?: boolean
}

interface Department {
  id: number
  name: string
}

interface LeadStatus {
  id: number
  name: string
}

export default function BulkEmail() {
  const [targetAudience, setTargetAudience] = useState<'department' | 'status' | 'all'>('department')
  const [departmentId, setDepartmentId] = useState('')
  const [leadStatusId, setLeadStatusId] = useState('')
  const [signatureId, setSignatureId] = useState<string>('')
  const [templateId, setTemplateId] = useState('')
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['comm', 'templates'],
    queryFn: communicationApi.templates,
  })
  const { data: signatures = [] } = useQuery<Signature[]>({
    queryKey: ['comm', 'signatures'],
    queryFn: communicationApi.signatures,
  })
  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['lead-config', 'departments'],
    queryFn: leadConfigApi.departments,
  })
  const { data: statuses = [] } = useQuery<LeadStatus[]>({
    queryKey: ['lead-config', 'statuses'],
    queryFn: leadConfigApi.statuses,
  })

  // Pre-fill subject/body when template selected
  useEffect(() => {
    if (!templateId) return
    const tpl = templates.find((t) => String(t.id) === templateId)
    if (tpl) {
      setSubject(tpl.subject || '')
      setContent(tpl.body || '')
    }
  }, [templateId, templates])

  // Default signature on load
  useEffect(() => {
    if (signatureId) return
    const def = signatures.find((s) => s.isDefault)
    if (def) setSignatureId(String(def.id))
  }, [signatures, signatureId])

  const sendMutation = useMutation({
    mutationFn: () =>
      communicationApi.sendBulkByFilter({
        subject,
        body: content,
        signatureId: signatureId ? Number(signatureId) : undefined,
        departmentId: targetAudience === 'department' && departmentId ? Number(departmentId) : undefined,
        leadStatusId: targetAudience === 'status' && leadStatusId ? Number(leadStatusId) : undefined,
        all: targetAudience === 'all',
      }),
    onSuccess: (r: any) => {
      toast.success(r?.message || 'Bulk email queued')
      setSubject('')
      setContent('')
      setTemplateId('')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to send'),
  })

  const canSend =
    !!subject.trim() &&
    !!content.trim() &&
    (targetAudience === 'all' ||
      (targetAudience === 'department' && departmentId) ||
      (targetAudience === 'status' && leadStatusId))

  const handleSend = () => {
    if (targetAudience === 'all') {
      if (!confirm('Send to ALL active leads? This is irreversible.')) return
    }
    sendMutation.mutate()
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-600 to-violet-400 bg-clip-text text-transparent flex items-center gap-2">
          <Send className="w-6 h-6 text-violet-500" />
          Bulk Email Campaign
        </h1>
        <button
          onClick={() => window.history.back()}
          className="px-4 py-2 bg-white border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 font-medium text-sm shadow-sm"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h2 className="font-bold text-gray-900 flex items-center gap-2 mb-6">
              <Settings className="w-4 h-4 text-gray-400" /> Configuration
            </h2>

            <div className="space-y-5">
              <div>
                <label className="text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-violet-500" /> Target Audience
                </label>
                <select
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value as any)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2 bg-gray-50"
                >
                  <option value="department">By Lead Department</option>
                  <option value="status">By Lead Status</option>
                  <option value="all">All Active Leads (DANGER)</option>
                </select>
              </div>

              {targetAudience === 'department' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Select Department</label>
                  <select
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2 bg-gray-50/50"
                  >
                    <option value="">-- Choose Department --</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {targetAudience === 'status' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Select Status</label>
                  <select
                    value={leadStatusId}
                    onChange={(e) => setLeadStatusId(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2 bg-gray-50/50"
                  >
                    <option value="">-- Choose Status --</option>
                    {statuses.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="pt-4 border-t border-gray-100">
                <label className="text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-violet-500" /> Signature
                </label>
                <select
                  value={signatureId}
                  onChange={(e) => setSignatureId(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2 bg-gray-50"
                >
                  <option value="">-- No Signature --</option>
                  {signatures.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} {s.isDefault ? '(default)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <label className="text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5">
                  <LayoutTemplate className="w-3.5 h-3.5 text-violet-500" /> Load Template
                </label>
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2 bg-gray-50"
                >
                  <option value="">-- Start from Scratch --</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 p-5 rounded-2xl">
            <h3 className="text-amber-800 font-bold mb-2">Send Campaign</h3>
            <p className="text-sm text-amber-900/80 mb-4">
              Emails are sent in chunks of 10. Use the <code>{`{{name}}`}</code> placeholder for personalization.
            </p>
            <button
              onClick={handleSend}
              disabled={!canSend || sendMutation.isPending}
              className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-md ${
                !canSend || sendMutation.isPending
                  ? 'bg-violet-300 text-white cursor-not-allowed'
                  : 'bg-violet-600 hover:bg-violet-700 text-white shadow-violet-500/25'
              }`}
            >
              <Send className="w-5 h-5" />
              {sendMutation.isPending ? 'Sending...' : 'Send Campaign'}
            </button>
          </div>
        </div>

        <div className="col-span-1 lg:col-span-2">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-full min-h-[600px]">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center gap-4">
              <FileText className="w-5 h-5 text-gray-400 shrink-0" />
              <input
                type="text"
                placeholder="Campaign Subject Line"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full bg-transparent border-0 focus:ring-0 text-lg font-semibold text-gray-900 p-0 placeholder:text-gray-400 outline-none"
              />
            </div>

            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="flex-1 w-full p-6 border-0 focus:ring-0 resize-none text-gray-700 outline-none"
              placeholder="Draft your HTML email content here. Use {{name}} to insert the recipient's name."
            />

            <div className="bg-gray-50 border-t border-gray-100 px-6 py-3 text-xs text-gray-400 italic">
              Note: Content is sent as HTML. The selected signature is appended automatically.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
