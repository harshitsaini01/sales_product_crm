import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { b2bApi } from '@/lib/api'
import { toast } from 'sonner'
import { Loader2, Upload, FileText, X, AlertCircle, Download } from 'lucide-react'

interface Props {
  onClose: () => void
  onSuccess?: () => void
}

interface Row {
  name: string
  email?: string
  phone: string
  state?: string
}

function pick(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

export function ImportB2bModal({ onClose, onSuccess }: Props) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [sourceKind, setSourceKind] = useState<'csv' | 'xlsx'>('csv')
  const [error, setError] = useState('')

  const importMut = useMutation({
    mutationFn: () => b2bApi.import({ source: sourceKind, contacts: rows! }),
    onSuccess: (data) => {
      toast.success(`Imported ${data.inserted} contacts (${data.skipped} skipped)`)
      qc.invalidateQueries({ queryKey: ['b2b'] })
      onSuccess?.()
      onClose()
    },
    onError: () => toast.error('Import failed'),
  })

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setRows(null)

    const ext = file.name.split('.').pop()?.toLowerCase()
    const kind: 'csv' | 'xlsx' = ext === 'csv' ? 'csv' : 'xlsx'
    setSourceKind(kind)

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = ev.target?.result
        const wb = kind === 'csv'
          ? XLSX.read(data as string, { type: 'string' })
          : XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
        if (json.length === 0) return setError('No rows found')

        const parsed: Row[] = []
        let invalid = 0
        for (const r of json) {
          const name = pick(r, 'Name', 'name', 'NAME', 'Contact', 'contact')
          const phone = pick(r, 'Phone', 'phone', 'PHONE', 'Mobile', 'mobile')
          if (!name || !phone) { invalid++; continue }
          parsed.push({
            name,
            email: pick(r, 'Email', 'email', 'EMAIL') || undefined,
            phone,
            state: pick(r, 'State', 'state', 'STATE') || undefined,
          })
        }
        if (parsed.length === 0) return setError('No valid rows. Required columns: Name, Phone')
        setRows(parsed)
        if (invalid > 0) toast.info(`${invalid} rows skipped (missing name or phone)`)
      } catch (err) {
        console.error(err)
        setError('Failed to parse file')
      }
    }
    if (kind === 'csv') reader.readAsText(file)
    else reader.readAsArrayBuffer(file)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border rounded-lg p-6 w-full max-w-lg space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Import B2B Contacts</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 bg-muted/50 rounded-md text-xs space-y-2">
          <p className="font-medium">Required columns: <code>Name, Phone</code></p>
          <p className="text-muted-foreground">Optional: <code>Email, State</code></p>
          <button
            type="button"
            onClick={async () => {
              try {
                const blob = await b2bApi.downloadTemplate()
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = 'b2b_contacts_template.csv'
                a.click()
                URL.revokeObjectURL(url)
              } catch {
                toast.error('Failed to download template')
              }
            }}
            className="inline-flex items-center gap-1 text-primary hover:underline text-xs"
          >
            <Download className="h-3 w-3" /> Download CSV template
          </button>
        </div>

        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFile}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed rounded-lg p-6 hover:bg-muted/50 flex flex-col items-center gap-2 text-sm"
          >
            <Upload className="h-6 w-6 text-muted-foreground" />
            <span className="font-medium">Click to choose CSV or XLSX</span>
            <span className="text-xs text-muted-foreground">Max 50,000 rows</span>
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-2 rounded">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}

        {rows && (
          <div className="text-sm">
            <div className="flex items-center gap-2 text-emerald-600">
              <FileText className="h-4 w-4" />
              <span className="font-medium">{rows.length} valid contacts ready</span>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-md border hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={() => importMut.mutate()}
            disabled={!rows || importMut.isPending}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-50 flex items-center gap-2"
          >
            {importMut.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Import {rows ? `(${rows.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
