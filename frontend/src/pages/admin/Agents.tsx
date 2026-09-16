import { useState } from 'react'
import { Plus, Briefcase, Mail, Phone, Search, Edit, Trash2, X } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { agentsApi } from '@/lib/api'
import { normalizePhone } from '@/lib/utils'
import { toast } from 'sonner'

interface Agent {
  id: number
  name: string
  email: string
  mobile: string
  companyName?: string
  address?: string
  city?: string
  state?: string
  country?: string
  status: number
}

export default function Agents() {
  const qc = useQueryClient()
  const { data: agents = [], isLoading } = useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: agentsApi.list,
  })

  const [search, setSearch] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<Agent | null>(null)
  const [form, setForm] = useState<Partial<Agent>>({})

  const filtered = agents.filter(
    (a) =>
      a.name?.toLowerCase().includes(search.toLowerCase()) ||
      a.email?.toLowerCase().includes(search.toLowerCase()),
  )

  const reset = () => {
    setEditing(null)
    setForm({})
  }

  const openNew = () => {
    reset()
    setIsModalOpen(true)
  }

  const openEdit = (a: Agent) => {
    setEditing(a)
    setForm(a)
    setIsModalOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        email: form.email,
        mobile: normalizePhone(form.mobile),
        companyName: form.companyName,
        address: form.address,
        city: form.city,
        state: form.state,
        country: form.country,
      }
      return editing ? agentsApi.update(editing.id, payload) : agentsApi.create(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      toast.success(editing ? 'Agent updated' : 'Agent added')
      setIsModalOpen(false)
      reset()
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Save failed'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => agentsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Agent deactivated')
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
          Partner Agents
        </h1>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl hover:bg-gray-800 font-medium shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Add Agent
        </button>
      </div>

      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search agents by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-50 border-none rounded-xl focus:ring-2 focus:ring-black outline-none"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400 animate-pulse">Loading agents...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center text-gray-500">
          {agents.length === 0 ? 'No partner agents yet. Click "Add Agent" to register one.' : 'No matches.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((agent) => (
            <div
              key={agent.id}
              className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center border border-gray-100">
                  <Briefcase className="w-6 h-6 text-gray-400 group-hover:text-black" />
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2.5 py-1 text-xs font-semibold rounded-full ${
                      agent.status === 1 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {agent.status === 1 ? 'Active' : 'Inactive'}
                  </span>
                  <button onClick={() => openEdit(agent)} className="p-1 text-gray-400 hover:text-blue-500" title="Edit">
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Deactivate agent ${agent.name}?`)) deleteMutation.mutate(agent.id)
                    }}
                    className="p-1 text-gray-400 hover:text-red-500"
                    title="Deactivate"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <h3 className="font-bold text-gray-900 text-lg">{agent.name}</h3>
              <p className="text-sm text-gray-500 font-medium mb-4">
                {agent.companyName || 'Independent Agent'}
              </p>

              <div className="space-y-2 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4" /> {agent.email}
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4" /> {agent.mobile}
                </div>
                {(agent.city || agent.country) && (
                  <div className="text-xs text-gray-400">
                    {[agent.city, agent.state, agent.country].filter(Boolean).join(', ')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <h3 className="font-bold text-gray-900">{editing ? 'Edit Agent' : 'New Agent'}</h3>
              <button
                onClick={() => {
                  setIsModalOpen(false)
                  reset()
                }}
                className="p-1 hover:bg-gray-200 rounded-lg text-gray-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 grid grid-cols-2 gap-4">
              {(
                [
                  ['name', 'Full Name', true],
                  ['email', 'Email', true],
                  ['mobile', 'Mobile', true],
                  ['companyName', 'Company Name', false],
                  ['address', 'Address', false],
                  ['city', 'City', false],
                  ['state', 'State', false],
                  ['country', 'Country', false],
                ] as const
              ).map(([key, label, required]) => (
                <div key={key} className={key === 'address' ? 'col-span-2' : ''}>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    {label} {required && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type={key === 'email' ? 'email' : 'text'}
                    value={(form as any)[key] || ''}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2 bg-gray-50/50"
                  />
                </div>
              ))}
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => {
                  setIsModalOpen(false)
                  reset()
                }}
                className="px-4 py-2 font-medium text-gray-500"
              >
                Cancel
              </button>
              <button
                disabled={!form.name || !form.email || !form.mobile || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
                className="px-6 py-2 bg-black hover:bg-gray-800 text-white font-medium rounded-xl shadow-sm disabled:opacity-50"
              >
                {saveMutation.isPending ? 'Saving...' : editing ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
