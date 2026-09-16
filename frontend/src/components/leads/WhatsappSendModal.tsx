import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { whatsappTemplatesApi } from '@/lib/api'
import { productsApi, formatMoney, type Product } from '@/lib/deals-api'
import { toast } from 'sonner'
import { MessageSquare, X, Send, Paperclip, FileText, Download } from 'lucide-react'

interface WhatsappSendModalProps {
  isOpen: boolean
  onClose: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lead: any
  onSent?: () => void
}

export function WhatsappSendModal({ isOpen, onClose, lead, onSent }: WhatsappSendModalProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [messageText, setMessageText] = useState('')
  const [includeAttachments, setIncludeAttachments] = useState(true)

  // Fetch all templates
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['whatsapp-templates-modal'],
    queryFn: () => whatsappTemplatesApi.list({ category: 'all' }),
    enabled: isOpen,
  })

  const selectedTemplate = templates.find((t) => String(t.id) === selectedTemplateId)

  // Personalize placeholders in template text for the target lead
  const personalize = (text: string) => {
    if (!lead) return text
    const name = lead.name || 'there'
    const firstName = name.split(/\s+/)[0]
    return text
      .replace(/\{\{\s*name\s*\}\}/gi, name)
      .replace(/\{\{\s*firstName\s*\}\}/gi, firstName)
      .replace(/\{\{\s*mobile\s*\}\}/gi, lead.mobile || '')
      .replace(/\{\{\s*email\s*\}\}/gi, lead.email || '')
      .replace(/\{\{\s*course\s*\}\}/gi, lead.intrestedCourse || lead.course || '')
      .replace(/\{\{\s*country\s*\}\}/gi, lead.country || '')
  }

  // Reset or pre-select template when modal opens or template changes
  useEffect(() => {
    if (isOpen && templates.length > 0 && !selectedTemplateId) {
      // Default to first greeting template or first template
      const defaultTpl = templates.find((t) => t.category === 'greeting') || templates[0]
      if (defaultTpl) {
        setSelectedTemplateId(String(defaultTpl.id))
        setMessageText(personalize(defaultTpl.description))
      }
    }
  }, [isOpen, templates])

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId)
    const tpl = templates.find((t) => String(t.id) === templateId)
    if (tpl) {
      setMessageText(personalize(tpl.description))
    } else {
      setMessageText('')
    }
  }

  const getFileUrl = (filePath: string) => {
    if (filePath.startsWith('http')) return filePath
    const origin = window.location.origin.replace(':5173', ':3001')
    return `${origin}${filePath}`
  }

  const handleDownloadAttachments = () => {
    if (!selectedTemplate?.attachments || selectedTemplate.attachments.length === 0) return
    selectedTemplate.attachments.forEach((file) => {
      const link = document.createElement('a')
      link.href = getFileUrl(file.filePath)
      link.download = file.fileName
      link.target = '_blank'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    })
    toast.success('Downloaded attached files!')
  }

  const handleSend = () => {
    if (!lead?.mobile) {
      toast.error('This lead does not have a valid mobile number')
      return
    }

    let finalMessage = messageText.trim()

    // Append attachment links if template has attachments and option is checked
    if (includeAttachments && selectedTemplate?.attachments && selectedTemplate.attachments.length > 0) {
      const attachmentLinks = selectedTemplate.attachments.map((file) => {
        const fullUrl = getFileUrl(file.filePath)
        return `📄 ${file.fileName}: ${fullUrl}`
      }).join('\n')

      finalMessage += `\n\nAttachments:\n${attachmentLinks}`
    }

    // Format phone number for WhatsApp (strip non-digits, ensure country code)
    let phone = String(lead.mobile).replace(/\D/g, '')
    if (phone.length === 10) {
      phone = `91${phone}` // Default to India 91 if 10 digits
    }

    const encodedText = encodeURIComponent(finalMessage)
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${phone}&text=${encodedText}`

    // Open WhatsApp in new window
    window.open(whatsappUrl, '_blank')

    toast.success(`WhatsApp opened with template for ${lead.name}`)
    onSent?.()
    onClose()
  }

  if (!isOpen || !lead) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border rounded-2xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-emerald-600 text-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <MessageSquare className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-base">Send WhatsApp Message</h2>
              <p className="text-xs text-emerald-100">
                To: <span className="font-semibold text-white">{lead.name}</span> ({lead.mobile})
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-emerald-100 hover:bg-white/20 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body Form */}
        <div className="p-6 overflow-y-auto custom-scrollbar space-y-5 flex-1">
          {/* Select Template Dropdown */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground flex items-center justify-between">
              <span>Select WhatsApp Template</span>
              <span className="text-[10px] text-emerald-600 font-semibold">
                {templates.length} templates available
              </span>
            </label>

            {isLoading ? (
              <div className="h-10 border rounded-xl bg-muted/40 animate-pulse" />
            ) : (
              <select
                value={selectedTemplateId}
                onChange={(e) => handleTemplateSelect(e.target.value)}
                className="w-full px-3.5 py-2.5 border rounded-xl bg-background text-sm font-medium focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="">-- Custom Message (No Template) --</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    [{tpl.category.toUpperCase()}] {tpl.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Message Text Editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-foreground">Message Content</label>
              <span className="text-[10px] text-muted-foreground">
                Placeholders automatically personalized
              </span>
            </div>

            <WhatsappProductPicker
              onPick={(line) => setMessageText((t) => (t ? `${t}\n\n${line}` : line))}
            />

            <textarea
              rows={5}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Type your WhatsApp message..."
              className="w-full p-3.5 border rounded-xl bg-background text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-sans leading-relaxed"
            />
          </div>

          {/* Selected Template Attachments Preview */}
          {selectedTemplate?.attachments && selectedTemplate.attachments.length > 0 && (
            <div className="space-y-2 p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                  <Paperclip className="h-4 w-4 text-emerald-600" />
                  <span>Template Attachments ({selectedTemplate.attachments.length})</span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleDownloadAttachments}
                    className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:text-emerald-900 bg-white/80 dark:bg-black/30 px-2.5 py-1 rounded-md border border-emerald-500/30 transition-colors"
                    title="Download files locally to drag & drop into WhatsApp"
                  >
                    <Download className="h-3 w-3 text-emerald-600" />
                    <span>Download Files</span>
                  </button>

                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-900 dark:text-emerald-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeAttachments}
                      onChange={(e) => setIncludeAttachments(e.target.checked)}
                      className="rounded border-emerald-500 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>Include links</span>
                  </label>
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                {selectedTemplate.attachments.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-card border text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 text-emerald-600 shrink-0" />
                      <span className="truncate font-medium text-foreground text-[11px]">
                        {file.fileName}
                      </span>
                    </div>

                    <a
                      href={getFileUrl(file.filePath)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-emerald-600 hover:underline font-semibold"
                    >
                      View / Download
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t bg-muted/20">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border text-xs font-semibold hover:bg-accent transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSend}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md transition-all hover:scale-[1.02] active:scale-95"
          >
            <Send className="h-4 w-4" />
            <span>Send on WhatsApp</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function WhatsappProductPicker({ onPick }: { onPick: (line: string) => void }) {
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['products', 'mail-picker'],
    queryFn: () => productsApi.list(),
    staleTime: 60_000,
  })
  if (!products.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {products.map((p) => {
        const line = [p.name, p.unitPrice != null ? formatMoney(p.unitPrice, p.currency) : '', p.description]
          .filter(Boolean)
          .join(' — ')
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(line)}
            className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs hover:bg-accent"
          >
            {p.imageUrl && <img src={p.imageUrl} alt="" className="h-6 w-6 rounded object-cover" />}
            {p.name}
          </button>
        )
      })}
    </div>
  )
}
