import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth.store'
import { Link } from '@tanstack/react-router'
import { authApi, usersApi, remarksApi } from '@/lib/api'
import { toast } from 'sonner'
import {
  User as UserIcon,
  Mail,
  Phone,
  MapPin,
  Shield,
  Calendar,
  Lock,
  Loader2,
  Eye,
  EyeOff,
  Camera,
  Trash2,
  MessageSquareQuote,
  ChevronRight,
} from 'lucide-react'
import type { CounsellorRemark } from '@/types'
import { RemarkCardContent } from '@/pages/admin/Remarks'



interface Me {
  id: number
  name: string
  email: string
  mobile?: string
  role: string
  designation?: string
  branch?: { id: number; name: string; city?: string } | null
  city?: string
  state?: string
  country?: string
  imgpath?: string | null
  createdAt: string
  status: number
  roles?: { role: string }[]
}

export default function MyAccount() {
  const { user } = useAuthStore()

  // /auth/me returns the current user; we also use /users/:id for richer data + branch
  const { data: meRaw } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authApi.me,
  })
  const myId = Number(meRaw?.id ?? user?.id)
  const { data: me } = useQuery<Me>({
    queryKey: ['users', myId],
    queryFn: () => usersApi.get(myId),
    enabled: !!myId,
  })
  const { data: counts } = useQuery({
    queryKey: ['users', myId, 'lead-count'],
    queryFn: () => usersApi.leadCount(myId),
    enabled: !!myId,
  })

  if (!me) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const initials = me.name?.charAt(0).toUpperCase() || '?'
  return <ProfileBody me={me} initials={initials} myId={myId} counts={counts} />
}

function ProfileBody({
  me, initials, myId, counts,
}: {
  me: Me
  initials: string
  myId: number
  counts?: { total: number; today: number; thisMonth: number }
}) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const uploadPhoto = useMutation({
    mutationFn: (file: File) => usersApi.uploadPhoto(myId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users', myId] })
      toast.success('Photo updated')
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Upload failed'),
  })

  const removePhoto = useMutation({
    mutationFn: () => usersApi.removePhoto(myId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users', myId] })
      toast.success('Photo removed')
    },
  })

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Max file size is 10MB')
      return
    }
    uploadPhoto.mutate(file)
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <UserIcon className="h-6 w-6 text-muted-foreground" />
          My Account
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your profile and security</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-card border rounded-2xl shadow-sm overflow-hidden text-center relative">
            <div className="h-24 bg-gradient-to-r from-primary to-primary/60" />
            <div className="px-6 pb-8 -mt-12">
              <div className="relative inline-flex items-center justify-center w-24 h-24 bg-card rounded-full p-1 shadow-md border group">
                {me.imgpath ? (
                  <img
                    src={me.imgpath}
                    alt={me.name}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-primary/10 text-primary rounded-full flex items-center justify-center text-3xl font-bold">
                    {initials}
                  </div>
                )}
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadPhoto.isPending}
                  className="absolute bottom-0 right-0 p-1.5 bg-primary text-primary-foreground rounded-full shadow-md hover:bg-primary/90 disabled:opacity-50"
                  title="Change photo"
                >
                  {uploadPhoto.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Camera className="h-3 w-3" />
                  )}
                </button>
                {me.imgpath && (
                  <button
                    onClick={() => {
                      if (confirm('Remove profile photo?')) removePhoto.mutate()
                    }}
                    className="absolute bottom-0 left-0 p-1.5 bg-card border text-destructive rounded-full shadow-md hover:bg-destructive/10"
                    title="Remove photo"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPickFile}
                />
              </div>
              <h2 className="mt-4 text-xl font-bold">{me.name}</h2>
              <p className="text-sm text-muted-foreground capitalize">
                {me.designation || me.role}
              </p>

              <div
                className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                  me.status === 1 ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                }`}
              >
                <Shield className="h-3 w-3" /> {me.status === 1 ? 'Active' : 'Inactive'}
              </div>

              <div className="mt-6 space-y-3 text-left text-sm border-t pt-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-4 w-4 shrink-0" />
                  <span className="truncate">{me.email}</span>
                </div>
                {me.mobile && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4 shrink-0" /> {me.mobile}
                  </div>
                )}
                {me.branch && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4 shrink-0" /> {me.branch.name}
                  </div>
                )}
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-4 w-4 shrink-0" /> Joined{' '}
                  {new Date(me.createdAt).toLocaleDateString()}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          {counts && (
            <div className="grid grid-cols-3 gap-4">
              <MetricCard label="Total Assigned" value={counts.total} />
              <MetricCard label="This Month" value={counts.thisMonth} accent="text-blue-600" />
              <MetricCard label="Today" value={counts.today} accent="text-emerald-600" />
            </div>
          )}

          <ChangePasswordCard />
          <MyRemarksCard userId={myId} />
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-card border rounded-xl p-5 shadow-sm">
      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-3xl font-black mt-1 ${accent || ''}`}>{value.toLocaleString()}</p>
    </div>
  )
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    setSubmitting(true)
    try {
      await authApi.changePassword({ currentPassword, newPassword })
      toast.success('Password updated')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Failed to update password')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-card border rounded-2xl shadow-sm p-6">
      <h3 className="font-bold flex items-center gap-2 mb-4">
        <Lock className="h-4 w-4 text-primary" />
        Change Password
      </h3>

      <form onSubmit={onSubmit} className="space-y-4 max-w-md">
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Current Password</label>
          <div className="relative mt-1">
            <input
              type={showOld ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 pr-10 border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowOld((p) => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              {showOld ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">New Password</label>
          <div className="relative mt-1">
            <input
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 pr-10 border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowNew((p) => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">Confirm New Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full mt-1 px-3 py-2 border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            autoComplete="new-password"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !currentPassword || !newPassword || !confirmPassword}
          className="px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Update Password
        </button>
      </form>
    </div>
  )
}

function MyRemarksCard({ userId }: { userId: number }) {
  const { data: remarks = [], isLoading } = useQuery<CounsellorRemark[]>({
    queryKey: ['remarks', { counsellorId: userId }],
    queryFn: () => remarksApi.list({ counsellorId: userId }),
    enabled: !!userId,
  })

  return (
    <div className="bg-card border rounded-2xl shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold flex items-center gap-2 text-foreground">
          <MessageSquareQuote className="h-4 w-4 text-primary" />
          My Remarks
          <span className="px-2 py-0.5 text-xs font-semibold bg-primary/10 text-primary rounded-full">
            {remarks.length}
          </span>
        </h3>
        <Link
          to="/app/remarks"
          className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
        >
          View all <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : remarks.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No remarks assigned to you yet.</p>
      ) : (
        <div className="space-y-3">
          {remarks.slice(0, 3).map((r) => (
            <div key={r.id} className="p-3 border rounded-xl bg-muted/20 space-y-2 text-xs">
              <div className="flex items-center justify-between text-muted-foreground font-medium">
                <span>By <strong className="text-foreground">{r.createdBy?.name || 'Admin'}</strong></span>
                <span>{new Date(r.createdAt).toLocaleDateString()}</span>
              </div>
              <RemarkCardContent remark={r} />
            </div>
          ))}
        </div>

      )}
    </div>
  )
}

