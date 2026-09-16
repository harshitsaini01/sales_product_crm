import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Mail, MessageSquare, Package, Send } from 'lucide-react'
import { toast } from 'sonner'
import { leadsApi } from '@/lib/api'
import { formatMoney, productsApi, type Product } from '@/lib/deals-api'
import { cn } from '@/lib/utils'

export function SendCatalogPanel({
  leadId,
  hasEmail,
  hasMobile,
}: {
  leadId: number
  hasEmail: boolean
  hasMobile: boolean
}) {
  const qc = useQueryClient()
  const [picked, setPicked] = useState<number[]>([])
  const [channel, setChannel] = useState<'email' | 'whatsapp'>(hasEmail ? 'email' : 'whatsapp')
  const [note, setNote] = useState('')

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', 'catalog'],
    queryFn: () => productsApi.list({ active: true }),
  })

  const { data: sends = [] } = useQuery({
    queryKey: ['lead-catalog-sends', leadId],
    queryFn: () => leadsApi.catalogSends(leadId),
  })

  const send = useMutation({
    mutationFn: () => leadsApi.sendCatalog(leadId, { productIds: picked, channel, note: note.trim() || undefined }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['lead-catalog-sends', leadId] })
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
      setPicked([])
      if (result.channel === 'whatsapp' && result.waUrl) {
        window.open(result.waUrl, '_blank', 'noopener,noreferrer')
        toast.success('WhatsApp opened with the products')
        return
      }
      if (result.email?.status === 'failed') {
        toast.error(result.email.error || 'Email failed')
        return
      }
      toast.success('Products emailed')
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error || 'Could not send')
    },
  })

  function toggle(id: number) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  const canSend =
    picked.length > 0 &&
    !send.isPending &&
    (channel === 'email' ? hasEmail : hasMobile)

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Package className="h-4 w-4" /> Send products
        </h2>
        <div className="flex rounded-md border overflow-hidden text-xs font-semibold">
          <button
            type="button"
            onClick={() => setChannel('email')}
            className={cn('px-3 py-1.5', channel === 'email' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
          >
            Email
          </button>
          <button
            type="button"
            onClick={() => setChannel('whatsapp')}
            className={cn('px-3 py-1.5', channel === 'whatsapp' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
          >
            WhatsApp
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : products.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add products first, then send them from here.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {products.map((p: Product) => {
            const on = picked.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                className={cn(
                  'text-left rounded-lg border overflow-hidden transition-colors',
                  on ? 'border-primary ring-2 ring-primary/30' : 'hover:border-foreground/30',
                )}
              >
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="h-24 w-full object-cover bg-muted" />
                ) : (
                  <div className="h-24 bg-muted flex items-center justify-center text-[11px] text-muted-foreground">
                    No photo
                  </div>
                )}
                <div className="p-2 space-y-0.5">
                  <p className="text-xs font-semibold line-clamp-2">{p.name}</p>
                  <p className="text-xs text-primary font-bold">{formatMoney(p.unitPrice)}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Optional note (Hi, here is what we discussed…)"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      />

      {channel === 'email' && !hasEmail && (
        <p className="text-xs text-amber-600">Add an email on this lead to send by mail.</p>
      )}
      {channel === 'whatsapp' && !hasMobile && (
        <p className="text-xs text-amber-600">Add a mobile number to send on WhatsApp.</p>
      )}

      <button
        type="button"
        disabled={!canSend}
        onClick={() => send.mutate()}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md bg-primary text-primary-foreground disabled:opacity-50"
      >
        {send.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : channel === 'email' ? <Mail className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
        <Send className="h-3.5 w-3.5" />
        Send {picked.length || ''} {channel === 'email' ? 'by email' : 'on WhatsApp'}
      </button>

      {sends.length > 0 && (
        <div className="border-t pt-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sent</p>
          {sends.map((s) => (
            <div key={s.id} className="text-sm flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium capitalize">{s.channel}</span>
              <span className="text-muted-foreground">
                {s.items.map((i) => i.name).join(', ')}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(s.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {s.sentBy?.name ? ` · ${s.sentBy.name}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
