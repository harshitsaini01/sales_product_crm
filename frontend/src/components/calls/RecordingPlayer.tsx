import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { Loader2, Play, AlertCircle, RefreshCw } from 'lucide-react'

/**
 * <audio> can't carry an Authorization header, so we fetch the recording with
 * the auth-aware axios client and convert the response to a blob URL.
 * The blob URL is created lazily on first Play tap and revoked on unmount.
 */
export function RecordingPlayer({ callId }: { callId: number }) {
  const [src, setSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  const load = async () => {
    if (src || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.get(`/calls/${callId}/recording`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      urlRef.current = url
      setSrc(url)
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status
      setError(status === 410 ? 'Recording expired' : status === 404 ? 'No recording' : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  if (error) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> {error}
        </span>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded border px-2 py-1 hover:bg-muted disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Retry
        </button>
      </span>
    )
  }
  if (!src) {
    return (
      <button
        onClick={load}
        disabled={loading}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border hover:bg-muted disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
        Play
      </button>
    )
  }
  return <audio controls src={src} className="h-8" preload="auto" />
}
