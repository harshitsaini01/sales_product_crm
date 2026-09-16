import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { chatApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { MessageCircle, Send, Search, Users as UsersIcon, ArrowLeft, Check, CheckCheck } from 'lucide-react'
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

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (same(d, today)) return 'Today'
  if (same(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ChatPage() {
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
    refetchInterval: 5_000,
  })

  const { data: messages = [] } = useQuery<ChatMessage[]>({
    queryKey: ['chat', 'messages', activeUserId],
    queryFn: () => (activeUserId ? chatApi.messages(activeUserId) : Promise.resolve([])),
    enabled: !!activeUserId,
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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])

  // Mark messages as seen when opening a conversation
  useEffect(() => {
    if (activeUserId) {
      chatApi.markSeen(activeUserId).then(() => {
        qc.invalidateQueries({ queryKey: ['chat', 'unread-count'] })
        qc.invalidateQueries({ queryKey: ['chat', 'users'] })
      })
    }
  }, [activeUserId, qc])

  const filteredUsers = users.filter(
    (u) => u.id !== myId && u.name.toLowerCase().includes(search.toLowerCase()),
  )

  const activeUser = users.find((u) => u.id === activeUserId)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <MessageCircle className="h-5 w-5 text-primary" />
          </div>
          Team Chat
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Message your teammates directly</p>
      </div>

      <div className="bg-card border rounded-xl overflow-hidden" style={{ height: 'calc(100vh - 220px)', minHeight: '500px' }}>
        <div className="flex h-full">
          {/* Users sidebar */}
          <div className={cn(
            'w-full sm:w-80 border-r flex flex-col shrink-0',
            activeUserId ? 'hidden sm:flex' : 'flex',
          )}>
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
                        className={cn(
                          'w-full text-left px-5 py-3.5 flex items-center gap-3 transition-colors',
                          activeUserId === u.id
                            ? 'bg-primary/5 border-l-2 border-l-primary'
                            : 'hover:bg-accent/50',
                        )}
                      >
                        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-sm shrink-0">
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
          </div>

          {/* Chat area */}
          <div className={cn(
            'flex-1 flex flex-col',
            !activeUserId ? 'hidden sm:flex' : 'flex',
          )}>
            {!activeUserId ? (
              <div className="flex-1 flex items-center justify-center text-center p-8">
                <div>
                  <MessageCircle className="h-16 w-16 mx-auto text-muted-foreground/20 mb-4" />
                  <p className="font-semibold text-muted-foreground">Select a conversation</p>
                  <p className="text-sm text-muted-foreground/60 mt-1">Choose a teammate to start chatting</p>
                </div>
              </div>
            ) : (
              <>
                {/* Chat header */}
                <div className="px-5 py-3 border-b flex items-center gap-3 bg-[#f0f2f5] dark:bg-[#202c33]">
                  <button
                    onClick={() => setActiveUserId(null)}
                    className="sm:hidden p-1.5 rounded-lg hover:bg-black/5"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <div className="w-10 h-10 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center text-sm shrink-0">
                    {activeUser?.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{activeUser?.name}</div>
                    {activeUser?.designation && (
                      <div className="text-xs text-muted-foreground truncate">{activeUser.designation}</div>
                    )}
                  </div>
                </div>

                {/* Messages */}
                <div
                  ref={scrollRef}
                  className="flex-1 overflow-y-auto px-5 py-4 bg-[#efeae2] dark:bg-[#0b141a]"
                  style={{
                    backgroundImage:
                      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60'><circle cx='30' cy='30' r='1.2' fill='%23000' fill-opacity='0.04'/></svg>\")",
                  }}
                >
                  {messages.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-12">
                      No messages yet — say hello! 👋
                    </p>
                  ) : (
                    messages.map((m, i) => {
                      const mine = m.fromId === myId
                      const prev = messages[i - 1]
                      const next = messages[i + 1]
                      const prevDay = prev ? dayLabel(prev.createdAt) : null
                      const thisDay = dayLabel(m.createdAt)
                      const showDay = thisDay !== prevDay
                      const sameSenderAsPrev = !!prev && prev.fromId === m.fromId && !showDay
                      const sameSenderAsNext = !!next && next.fromId === m.fromId && dayLabel(next.createdAt) === thisDay
                      const showTail = !sameSenderAsNext

                      return (
                        <div key={m.id}>
                          {showDay && (
                            <div className="flex justify-center my-4">
                              <span className="text-[11px] font-medium px-3 py-1 rounded-full bg-white/80 dark:bg-white/10 text-muted-foreground shadow-sm">
                                {thisDay}
                              </span>
                            </div>
                          )}
                          <div
                            className={cn(
                              'flex',
                              mine ? 'justify-end' : 'justify-start',
                              sameSenderAsPrev ? 'mt-0.5' : 'mt-2',
                            )}
                          >
                            <div
                              className={cn(
                                'relative max-w-[75%] pl-3 pr-2.5 py-1.5 text-sm break-words whitespace-pre-wrap shadow-sm',
                                mine
                                  ? 'bg-[#d9fdd3] dark:bg-[#005c4b] text-foreground dark:text-white rounded-lg'
                                  : 'bg-white dark:bg-[#202c33] text-foreground dark:text-white rounded-lg',
                                showTail && (mine ? 'rounded-tr-sm' : 'rounded-tl-sm'),
                              )}
                            >
                              <div className="pr-14">{m.message}</div>
                              <div
                                className={cn(
                                  'absolute bottom-1 right-2 flex items-center gap-1 text-[10px] leading-none',
                                  mine ? 'text-emerald-700/70 dark:text-white/60' : 'text-muted-foreground',
                                )}
                              >
                                <span>
                                  {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                {mine && (
                                  m.seen === 1 ? (
                                    <CheckCheck className="h-3.5 w-3.5 text-sky-500" />
                                  ) : (
                                    <Check className="h-3.5 w-3.5" />
                                  )
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Input */}
                <form
                  onSubmit={(e) => { e.preventDefault(); sendMutation.mutate() }}
                  className="p-3 flex items-center gap-2.5 bg-[#f0f2f5] dark:bg-[#202c33] border-t"
                >
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Type a message"
                    className="flex-1 px-4 py-2.5 bg-white dark:bg-[#2a3942] border-none rounded-full text-sm outline-none focus:ring-2 focus:ring-primary/30 shadow-sm"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || sendMutation.isPending}
                    className="h-10 w-10 flex items-center justify-center bg-emerald-500 hover:bg-emerald-600 text-white rounded-full disabled:opacity-50 disabled:hover:bg-emerald-500 transition-colors shadow-sm shrink-0"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
