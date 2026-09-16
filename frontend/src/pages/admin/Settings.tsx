import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Loader2 } from 'lucide-react'
import { settingsApi, activityApi, type InactivityConfig } from '@/lib/api'
import { toast } from 'sonner'

export default function Settings() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery<Record<string, string>>({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  })

  const { data: inactivityCfg } = useQuery<InactivityConfig>({
    queryKey: ['activity-config'],
    queryFn: activityApi.config,
  })

  const [pageLimit, setPageLimit] = useState('100')

  // Inactivity tracker state — synced from server on first load.
  const [inactivityEnabled, setInactivityEnabled] = useState(true)
  const [warningMin, setWarningMin] = useState('3')
  const [alertMin, setAlertMin] = useState('6')
  const [halfdayMin, setHalfdayMin] = useState('15')

  useEffect(() => {
    if (data?.page_limit) setPageLimit(String(data.page_limit))
  }, [data])

  useEffect(() => {
    if (!inactivityCfg) return
    setInactivityEnabled(inactivityCfg.enabled)
    setWarningMin(String(inactivityCfg.warningMinutes))
    setAlertMin(String(inactivityCfg.alertMinutes))
    setHalfdayMin(String(inactivityCfg.halfdayMinutes))
  }, [inactivityCfg])

  const savePageLimit = useMutation({
    mutationFn: (limit: number) => settingsApi.setPageLimit(limit),
    onSuccess: () => {
      toast.success('Settings saved')
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Failed to save')
    },
  })

  const saveInactivity = useMutation({
    mutationFn: (cfg: Partial<InactivityConfig>) => activityApi.saveConfig(cfg),
    onSuccess: () => {
      toast.success('Inactivity tracker settings saved')
      qc.invalidateQueries({ queryKey: ['activity-config'] })
      qc.invalidateQueries({ queryKey: ['activity-status'] })
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Failed to save')
    },
  })

  function handleSave() {
    const n = Number(pageLimit)
    if (!n || n < 10 || n > 500) {
      toast.error('Page limit must be between 10 and 500')
      return
    }
    savePageLimit.mutate(n)
  }

  function handleSaveInactivity() {
    const w = Number(warningMin)
    const a = Number(alertMin)
    const h = Number(halfdayMin)
    if (!w || w < 1) return toast.error('Warning must be at least 1 minute')
    if (!a || a <= w) return toast.error('Alert must be greater than warning')
    if (!h || h <= a) return toast.error('Half-day must be greater than alert')
    saveInactivity.mutate({
      enabled: inactivityEnabled,
      warningMinutes: w,
      alertMinutes: a,
      halfdayMinutes: h,
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
          System Settings
        </h1>
        <button
          onClick={handleSave}
          disabled={savePageLimit.isPending || isLoading}
          className="flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl hover:bg-gray-800 transition-all font-medium shadow-sm hover:shadow-md disabled:opacity-50"
        >
          {savePageLimit.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Changes
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">General Properties</h2>
            <p className="text-sm text-gray-500">Configure core CRM defaults</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Pagination Limit
              </label>
              <input
                type="number"
                min={10}
                max={500}
                value={pageLimit}
                onChange={(e) => setPageLimit(e.target.value)}
                disabled={isLoading}
                className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all disabled:opacity-50"
              />
              <p className="text-xs text-gray-500 mt-1">Number of rows to display by default in data tables (10–500)</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Third-Party Configs</h2>
            <p className="text-sm text-gray-500">Manage API keys and external integrations</p>
          </div>

          <div className="space-y-4">
            <div className="p-4 bg-gray-50 border border-gray-100 rounded-xl text-center text-sm text-gray-500">
              Other integrations can be added here
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4 md:col-span-2">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Counsellor Inactivity Tracker</h2>
              <p className="text-sm text-gray-500">
                Watches for counsellors not making calls or status updates. Combines
                activity from the web CRM and the mobile app.
              </p>
            </div>
            <label className="inline-flex items-center cursor-pointer gap-2">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={inactivityEnabled}
                onChange={(e) => setInactivityEnabled(e.target.checked)}
              />
              <div className="relative w-11 h-6 bg-gray-200 peer-checked:bg-green-500 rounded-full transition-colors">
                <div
                  className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full shadow transition-transform ${
                    inactivityEnabled ? 'translate-x-5' : ''
                  }`}
                />
              </div>
              <span className="text-sm font-medium text-gray-700">
                {inactivityEnabled ? 'On' : 'Off'}
              </span>
            </label>
          </div>

          <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 ${!inactivityEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Warning toast after (min)
              </label>
              <input
                type="number"
                min={1}
                value={warningMin}
                onChange={(e) => setWarningMin(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
              />
              <p className="text-xs text-gray-500 mt-1">Toast nudge, easy to miss.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Full-page alert after (min)
              </label>
              <input
                type="number"
                min={1}
                value={alertMin}
                onChange={(e) => setAlertMin(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
              />
              <p className="text-xs text-gray-500 mt-1">Blocks the UI — must press &quot;Mark as Read&quot;.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mark as half-day after (min)
              </label>
              <input
                type="number"
                min={1}
                value={halfdayMin}
                onChange={(e) => setHalfdayMin(e.target.value)}
                className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all"
              />
              <p className="text-xs text-gray-500 mt-1">Auto-creates an approved half-day leave row.</p>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSaveInactivity}
              disabled={saveInactivity.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-black text-white rounded-xl hover:bg-gray-800 transition-all font-medium shadow-sm disabled:opacity-50"
            >
              {saveInactivity.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Tracker Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
