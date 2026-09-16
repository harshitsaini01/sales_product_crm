import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { chatApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { MessageCircle, Send, X, Search, Users as UsersIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ChatUser {
  id: number
  name: string
  designation?: string
  unread: number
  lastMessageAt: string | null
}

interface ChatMessage {
  id: number
  fromId: number
  toId: number
  message: string
  seen: number
  locked: number
  createdAt: string
}

interface ChatDrawerProps {
  isOpen: boolean
  onClose: () => void
}

export function ChatDrawer({ isOpen, onClose }: ChatDrawerProps) {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const myId = Number(user?.id)
  const [activeUserId, setActiveUserId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data: users = [] } = useQuery<ChatUser[]>({
    queryKey: ['chat', 'users'],
    queryFn: () => chatApi.users(),
    enabled: isOpen,
    refetchInterval: isOpen ? 5_000 : false,
  })

  const { data: messages = [] } = useQuery<ChatMessage[]>({
    queryKey: ['chat', 'messages', activeUserId],
    queryFn: () => (activeUserId ? chatApi.messages(activeUserId) : Promise.resolve([])),
    enabled: !!activeUserId && isOpen,
    refetchInterval: 5_000,
  })

  const sendMutation = useMutation({
    mutationFn: () => {
      if (!activeUserId || !draft.trim()) throw new Error('Need recipient and message')
      return chatApi.send({ toId: activeUserId, message: draft.trim() })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'messages', activeUserId] })
      qc.invalidateQueries({ queryKey: ['chat', 'unread-count'] })
      qc.invalidateQueries({ queryKey: ['chat', 'users'] })
      setDraft('')
    },
  })

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])

  const filteredUsers = users.filter(
    (u) => u.id !== myId && u.name.toLowerCase().includes(search.toLowerCase()),
  )

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-card border-l shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-bold text-lg flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-primary" />
            Team Chat
          </h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!activeUserId ? (
          <>
            <div className="p-4 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search teammates..."
                  className="w-full pl-9 pr-3 py-2 bg-muted border-none rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredUsers.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  <UsersIcon className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No teammates found.
                </div>
              ) : (
                <ul className="divide-y">
                  {filteredUsers.map((u) => (
                    <li key={u.id}>
                      <button
                        onClick={() => setActiveUserId(u.id)}
                        className="w-full text-left px-5 py-3 hover:bg-accent/50 flex items-center gap-3"
                      >
                        <div className="w-9 h-9 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-sm shrink-0">
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-sm truncate">{u.name}</div>
                          {u.designation && (
                            <div className="text-xs text-muted-foreground truncate">{u.designation}</div>
                          )}
                        </div>
                        {u.unread > 0 && (
                          <span className="ml-auto shrink-0 bg-green-500 text-white text-[11px] font-bold rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center">
                            {u.unread > 99 ? '99+' : u.unread}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="px-5 py-3 border-b flex items-center gap-3 bg-muted/30">
              <button
                onClick={() => setActiveUserId(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back
              </button>
              <div className="font-semibold text-sm">
                {users.find((u) => u.id === activeUserId)?.name}
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {messages.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No messages yet — say hello.
                </p>
              ) : (
                messages.map((m) => {
                  const mine = m.fromId === myId
                  return (
                    <div
                      key={m.id}
                      className={cn('flex', mine ? 'justify-end' : 'justify-start')}
                    >
                      <div
                        className={cn(
                          'max-w-[75%] px-3 py-2 rounded-2xl text-sm break-words',
                          mine
                            ? 'bg-primary text-primary-foreground rounded-br-sm'
                            : 'bg-muted text-foreground rounded-bl-sm',
                        )}
                      >
                        {m.message}
                        <div
                          className={cn(
                            'text-[10px] mt-0.5 opacity-70',
                            mine ? 'text-right' : 'text-left',
                          )}
                        >
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                sendMutation.mutate()
              }}
              className="border-t p-3 flex items-center gap-2"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 px-3 py-2 bg-muted border-none rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sendMutation.isPending}
                className="p-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </>
        )}
      </div>
    </>
  )
}
