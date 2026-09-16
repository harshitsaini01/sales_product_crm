import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { appReleasesApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { formatDate, downloadBlob } from '@/lib/utils'
import { toast } from 'sonner'
import { Smartphone, Upload, Download, Trash2, Loader2, AlertTriangle, FileBadge } from 'lucide-react'

interface Release {
  id: number
  versionCode: number
  versionName: string
  fileUrl: string
  sha256: string
  sizeBytes: number
  releaseNotes: string | null
  isMandatory: boolean
  isPublished: boolean
  uploadedAt: string
  uploader: { id: number; name: string } | null
}

export default function AppRelease() {
  const { isAdmin } = useAuthStore()
  const qc = useQueryClient()
  const { data: releases = [], isLoading } = useQuery<Release[]>({
    queryKey: ['app-releases'],
    queryFn: appReleasesApi.list,
  })

  const [apk, setApk] = useState<File | null>(null)
  const [versionCode, setVersionCode] = useState('')
  const [versionName, setVersionName] = useState('')
  const [releaseNotes, setReleaseNotes] = useState('')
  const [isMandatory, setIsMandatory] = useState(false)

  const upload = useMutation({
    mutationFn: () => {
      if (!apk) throw new Error('Pick an APK file')
      return appReleasesApi.upload({
        apk,
        versionCode: Number(versionCode),
        versionName: versionName.trim(),
        releaseNotes: releaseNotes.trim() || undefined,
        isMandatory,
      })
    },
    onSuccess: () => {
      toast.success('Release uploaded')
      qc.invalidateQueries({ queryKey: ['app-releases'] })
      setApk(null); setVersionCode(''); setVersionName(''); setReleaseNotes(''); setIsMandatory(false)
      const input = document.getElementById('apk-input') as HTMLInputElement | null
      if (input) input.value = ''
    },
    onError: (err: { response?: { data?: { error?: string } } }) =>
      toast.error(err.response?.data?.error ?? 'Upload failed'),
  })

  const remove = useMutation({
    mutationFn: (id: number) => appReleasesApi.delete(id),
    onSuccess: () => {
      toast.success('Release deleted')
      qc.invalidateQueries({ queryKey: ['app-releases'] })
    },
  })

  const publish = useMutation({
    mutationFn: ({ id, isPublished }: { id: number; isPublished: boolean }) =>
      appReleasesApi.publish(id, isPublished),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['app-releases'] })
      toast.success(v.isPublished ? 'Released to counsellors' : 'Unpublished — counsellors will stop being prompted')
    },
    onError: () => toast.error('Could not change publish state'),
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Smartphone className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Counsellor App Releases</h1>
          <p className="text-sm text-muted-foreground">
            Upload signed APKs here. Counsellors auto-update from the mobile app.
          </p>
        </div>
      </div>

      {isAdmin() && (
        <div className="bg-card border rounded-lg p-5 space-y-4">
          <h2 className="font-semibold flex items-center gap-2"><Upload className="h-4 w-4" /> Upload new release</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-muted-foreground">APK file</label>
              <input
                id="apk-input"
                type="file"
                accept=".apk,application/vnd.android.package-archive"
                onChange={(e) => setApk(e.target.files?.[0] ?? null)}
                className="block w-full mt-1 text-sm"
              />
              {apk && <div className="text-xs text-muted-foreground mt-1">{apk.name} • {(apk.size / 1024 / 1024).toFixed(2)} MB</div>}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Version code (integer)</label>
              <input
                type="number"
                inputMode="numeric"
                placeholder="e.g. 2"
                value={versionCode}
                onChange={(e) => setVersionCode(e.target.value)}
                className="block w-full mt-1 px-3 py-1.5 border rounded bg-background text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Version name</label>
              <input
                type="text"
                placeholder="e.g. 0.2.0"
                value={versionName}
                onChange={(e) => setVersionName(e.target.value)}
                className="block w-full mt-1 px-3 py-1.5 border rounded bg-background text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Release notes (markdown allowed)</label>
            <textarea
              rows={3}
              value={releaseNotes}
              onChange={(e) => setReleaseNotes(e.target.value)}
              placeholder="What changed in this build?"
              className="block w-full mt-1 px-3 py-2 border rounded bg-background text-sm"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isMandatory} onChange={(e) => setIsMandatory(e.target.checked)} />
            Force update — block app usage until counsellor installs this version
          </label>
          <button
            onClick={() => upload.mutate()}
            disabled={upload.isPending || !apk || !versionCode || !versionName}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md disabled:opacity-50"
          >
            {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload release
          </button>
        </div>
      )}

      {/* Release history */}
      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="p-4 border-b flex items-center gap-2">
          <FileBadge className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold">Release history</h2>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…</div>
        ) : releases.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No releases yet. Upload one above.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground bg-muted/30">
                  <th className="px-3 py-2 font-medium">Version</th>
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Size</th>
                  <th className="px-3 py-2 font-medium">SHA-256</th>
                  <th className="px-3 py-2 font-medium">Uploaded</th>
                  <th className="px-3 py-2 font-medium">By</th>
                  <th className="px-3 py-2 font-medium">Notes</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {releases.map((r) => (
                  <tr key={r.id} className="border-b hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">
                      {r.versionName}
                      {r.isMandatory && (
                        <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-xs">
                          <AlertTriangle className="h-3 w-3" /> Mandatory
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{r.versionCode}</td>
                    <td className="px-3 py-2">{(r.sizeBytes / 1024 / 1024).toFixed(2)} MB</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground" title={r.sha256}>{r.sha256.slice(0, 12)}…</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(r.uploadedAt)}</td>
                    <td className="px-3 py-2">{r.uploader?.name ?? '—'}</td>
                    <td className="px-3 py-2 max-w-xs truncate" title={r.releaseNotes ?? ''}>{r.releaseNotes ?? '—'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={async () => {
                          try {
                            const blob = await appReleasesApi.download(r.id)
                            downloadBlob(blob, `tutelage-counsellor-${r.versionName}.apk`)
                          } catch {
                            toast.error('Download failed')
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border hover:bg-muted mr-1"
                      >
                        <Download className="h-3 w-3" /> Download
                      </button>
                      {isAdmin() && (
                        <button
                          onClick={() => publish.mutate({ id: r.id, isPublished: !r.isPublished })}
                          disabled={publish.isPending}
                          className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded border mr-1 ${
                            r.isPublished
                              ? 'text-amber-700 hover:bg-amber-50'
                              : 'text-emerald-700 hover:bg-emerald-50'
                          }`}
                        >
                          {r.isPublished ? 'Unpublish' : 'Publish'}
                        </button>
                      )}
                      {isAdmin() && (
                        <button
                          onClick={() => { if (confirm('Delete this release?')) remove.mutate(r.id) }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
