import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { leadsApi } from '@/lib/api'
import { toast } from 'sonner'
import { Loader2, Upload, FileText, X, AlertCircle } from 'lucide-react'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

export function ImportCsvModal({ onClose, onSuccess }: Props) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<Record<string, string>[] | null>(null)
  const [parseError, setParseError] = useState('')

  const importMutation = useMutation({
    mutationFn: () => leadsApi.import(parsed!),
    onSuccess: (data) => {
      toast.success(data.message)
      qc.invalidateQueries({ queryKey: ['leads'] })
      onSuccess()
    },
    onError: () => toast.error('Import failed'),
  })

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError('')
    setParsed(null)

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      try {
        const rows = parseCsv(text)
        if (rows.length === 0) return setParseError('No data rows found in CSV')
        if (!rows[0].name && !rows[0].Name) return setParseError('CSV must have a "name" column')
        setParsed(rows)
      } catch {
        setParseError('Failed to parse CSV file')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border rounded-lg p-6 w-full max-w-lg space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Import Leads from CSV</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 bg-muted/50 rounded-md text-xs text-muted-foreground">
          <p className="font-medium mb-1">Required columns:</p>
          <p>name — Lead full name</p>
          <p className="mt-1 font-medium">Optional columns:</p>
          <p>email, mobile, city, state, country, source, website, lead_type</p>
        </div>

        <div
          className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">Click to select CSV file</p>
          <p className="text-xs text-muted-foreground mt-1">or drag and drop</p>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
        </div>

        {parseError && (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {parseError}
          </div>
        )}

        {parsed && (
          <div className="flex items-center gap-2 p-3 bg-green-50 text-green-800 rounded-md text-sm">
            <FileText className="h-4 w-4 shrink-0" />
            {parsed.length} leads ready to import
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm border rounded-md hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={() => importMutation.mutate()}
            disabled={importMutation.isPending || !parsed}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            {importMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Import {parsed ? `${parsed.length} Leads` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''))
    return Object.fromEntries(headers.map((h, i) => [h, values[i] || '']))
  })
}
