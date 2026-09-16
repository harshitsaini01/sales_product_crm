import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Briefcase, Mail, Phone, MapPin, Calendar, Building2 } from 'lucide-react'
import { agentsApi } from '@/lib/api'

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
  createdAt?: string
}

export default function AgentProfile() {
  const { id } = useParams({ strict: false }) as { id: string }
  const agentId = Number(id)

  const { data: agent, isLoading } = useQuery<Agent>({
    queryKey: ['agents', agentId],
    queryFn: () => agentsApi.get(agentId),
    enabled: !!agentId,
  })

  if (isLoading) return <div className="p-12 text-center text-gray-500 animate-pulse">Loading agent profile...</div>
  if (!agent) return <div className="p-12 text-center text-red-500">Agent not found.</div>

  const initials = agent.name?.charAt(0).toUpperCase() || '?'

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <Briefcase className="w-6 h-6 text-gray-400" />
        Agent Profile
      </h1>

      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="h-24 bg-gradient-to-r from-gray-900 to-gray-700" />
        <div className="px-8 pb-8 -mt-12">
          <div className="inline-flex items-center justify-center w-24 h-24 bg-white rounded-full p-1 shadow-md border border-gray-100">
            <div className="w-full h-full bg-gray-50 text-gray-700 rounded-full flex items-center justify-center text-3xl font-bold">
              {initials}
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{agent.name}</h2>
              <p className="text-sm text-gray-500">{agent.companyName || 'Independent Agent'}</p>
            </div>
            <span
              className={`px-3 py-1 text-xs font-semibold rounded-full ${
                agent.status === 1 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}
            >
              {agent.status === 1 ? 'Active' : 'Inactive'}
            </span>
          </div>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <Field icon={<Mail className="w-4 h-4 text-gray-400" />} label="Email" value={agent.email} />
            <Field icon={<Phone className="w-4 h-4 text-gray-400" />} label="Mobile" value={agent.mobile} />
            <Field
              icon={<Building2 className="w-4 h-4 text-gray-400" />}
              label="Company"
              value={agent.companyName || '—'}
            />
            <Field
              icon={<MapPin className="w-4 h-4 text-gray-400" />}
              label="Location"
              value={[agent.city, agent.state, agent.country].filter(Boolean).join(', ') || '—'}
            />
            {agent.address && <Field icon={<MapPin className="w-4 h-4 text-gray-400" />} label="Address" value={agent.address} />}
            {agent.createdAt && (
              <Field
                icon={<Calendar className="w-4 h-4 text-gray-400" />}
                label="Joined"
                value={new Date(agent.createdAt).toLocaleDateString()}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-gray-50/50 border border-gray-100">
      {icon}
      <div className="flex-1">
        <div className="text-xs text-gray-400 uppercase font-semibold tracking-wider">{label}</div>
        <div className="font-medium text-gray-900">{value}</div>
      </div>
    </div>
  )
}
