import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { leadsApi } from '@/lib/api'
import { formatDate, getFileUrl } from '@/lib/utils'
import { toast } from 'sonner'
import { Upload, FileText, Trash2, Loader2, Download } from 'lucide-react'
import type { StudentDocument } from '@/types'

export function LeadDocumentsTab({ leadId }: { leadId: number }) {
  const qc = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')

  const { data: docs = [], isLoading } = useQuery<StudentDocument[]>({
    queryKey: ['lead-documents', leadId],
    queryFn: () => leadsApi.documents(leadId),
  })

  const upload = useMutation({
    mutationFn: ({ file, title }: { file: File; title?: string }) =>
      leadsApi.uploadDocument(leadId, file, title),
    onSuccess: () => {
      toast.success('Document uploaded')
      setTitle('')
      if (fileInput.current) fileInput.current.value = ''
      qc.invalidateQueries({ queryKey: ['lead-documents', leadId] })
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Upload failed')
    },
  })

  const del = useMutation({
    mutationFn: (docId: number) => leadsApi.deleteDocument(leadId, docId),
    onSuccess: () => {
      toast.success('Deleted')
      qc.invalidateQueries({ queryKey: ['lead-documents', leadId] })
    },
    onError: () => toast.error('Failed to delete'),
  })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    upload.mutate({ file, title: title.trim() || undefined })
  }

  return (
    <div className="space-y-4">
      <div className="bg-card border rounded-lg p-4 space-y-3">
        <h3 className="font-semibold text-sm">Upload Document</h3>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional, defaults to filename)"
            className="flex-1 min-w-[200px] px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            ref={fileInput}
            type="file"
            onChange={handleFileChange}
            disabled={upload.isPending}
            className="hidden"
            id="lead-doc-file"
            accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx"
          />
          <label
            htmlFor="lead-doc-file"
            className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-md cursor-pointer font-medium ${
              upload.isPending ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {upload.isPending ? 'Uploading...' : 'Choose File'}
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Supported: JPG, PNG, PDF, DOC, XLS · Max 10MB
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : !docs.length ? (
        <div className="text-center py-12 text-muted-foreground bg-card border rounded-lg">
          <FileText className="h-10 w-10 mx-auto mb-2 text-muted-foreground/40" />
          No documents uploaded yet
        </div>
      ) : (
        <div className="bg-card border rounded-lg divide-y">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 p-3">
              <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{doc.title}</p>
                <p className="text-xs text-muted-foreground">
                  {doc.filename} · {formatDate(doc.createdAt)}
                </p>
              </div>
              <a
                href={getFileUrl(doc.filepath)}
                target="_blank"
                rel="noreferrer"
                className="p-2 hover:bg-accent rounded-md"
                title="Download"
              >
                <Download className="h-3.5 w-3.5" />
              </a>
              <button
                onClick={() => { if (confirm('Delete this document?')) del.mutate(doc.id) }}
                className="p-2 hover:bg-accent rounded-md text-red-500"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
