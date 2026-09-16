import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { branchesApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import { toast } from 'sonner'
import { Network, Plus, Trash2, Edit2, MapPin, Loader2 } from 'lucide-react'

interface Branch {
  id: number
  name: string
  city?: string
  state?: string
  country?: string
  status: number
}

type BranchForm = {
  name: string
  city: string
  state: string
  country: string
  [k: string]: unknown
}

const emptyForm: BranchForm = { name: '', city: '', state: '', country: '' }

export default function Branches() {
  const { isAdmin } = useAuthStore()
  const qc = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Branch | null>(null)
  const [form, setForm] = useState<BranchForm>(emptyForm)

  const { data: branches = [], isLoading } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: branchesApi.list,
  })

  const createBranch = useMutation({
    mutationFn: (data: BranchForm) => branchesApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['branches'] })
      toast.success('Branch created')
      closeModal()
    },
    onError: () => toast.error('Failed to create branch'),
  })

  const updateBranch = useMutation({
    mutationFn: ({ id, data }: { id: number; data: BranchForm }) => branchesApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['branches'] })
      toast.success('Branch updated')
      closeModal()
    },
    onError: () => toast.error('Failed to update branch'),
  })

  const deleteBranch = useMutation({
    mutationFn: (id: number) => branchesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['branches'] })
      toast.success('Branch deleted')
    },
    onError: () => toast.error('Failed to delete branch'),
  })

  const openCreate = () => {
    setEditTarget(null)
    setForm(emptyForm)
    setIsModalOpen(true)
  }

  const openEdit = (branch: Branch) => {
    setEditTarget(branch)
    setForm({ name: branch.name, city: branch.city || '', state: branch.state || '', country: branch.country || '' })
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditTarget(null)
    setForm(emptyForm)
  }

  const handleSave = () => {
    if (!form.name.trim()) { toast.error('Branch name is required'); return }
    if (editTarget) {
      updateBranch.mutate({ id: editTarget.id, data: form })
    } else {
      createBranch.mutate(form)
    }
  }

  const handleDelete = (branch: Branch) => {
    if (!confirm(`Delete "${branch.name}"?`)) return
    deleteBranch.mutate(branch.id)
  }

  const isSaving = createBranch.isPending || updateBranch.isPending

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" />
            Branches
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{branches.length} office{branches.length !== 1 ? 's' : ''}</p>
        </div>
        {isAdmin() && (
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" /> Add Branch
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : branches.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border rounded-lg">
          <Network className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No branches yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {branches.map((branch) => (
            <div key={branch.id} className="bg-card border rounded-lg overflow-hidden hover:shadow-md transition-shadow">
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold">{branch.name}</h3>
                    {(branch.city || branch.state || branch.country) && (
                      <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" />
                        {[branch.city, branch.state, branch.country].filter(Boolean).join(', ')}
                      </div>
                    )}
                  </div>
                  <span className={`px-2 py-0.5 text-xs rounded-full ${branch.status === 1 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {branch.status === 1 ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              {isAdmin() && (
                <div className="px-5 py-3 bg-muted/30 border-t flex items-center justify-end gap-3">
                  <button
                    onClick={() => openEdit(branch)}
                    className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                  >
                    <Edit2 className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button
                    onClick={() => handleDelete(branch)}
                    className="flex items-center gap-1 text-sm text-red-600 hover:text-red-800"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-card w-full max-w-lg rounded-lg shadow-xl">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h3 className="font-semibold">{editTarget ? 'Edit Branch' : 'New Branch'}</h3>
              <button onClick={closeModal} className="text-muted-foreground hover:text-foreground text-xl leading-none">&times;</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Branch Name <span className="text-red-500">*</span></label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="e.g. Headquarters"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">City</label>
                  <input
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Delhi"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">State</label>
                  <input
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                    className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="Delhi"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Country</label>
                <input
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                  className="w-full px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="India"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t flex items-center justify-end gap-3">
              <button onClick={closeModal} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
              >
                {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {editTarget ? 'Save Changes' : 'Create Branch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
