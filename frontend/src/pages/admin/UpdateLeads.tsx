import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { leadsApi } from '@/lib/api'
import { toast } from 'sonner'
import {
  RefreshCw, Loader2, CheckCircle2, AlertTriangle, Search,
  Database, ChevronDown, Eye, ArrowRight, BadgeCheck,
} from 'lucide-react'
import { BulkPreviewModal } from '@/components/leads/BulkPreviewModal'
import { FieldUpdateLogs } from '@/components/leads/FieldUpdateLogs'
import VerifiedData from './VerifiedData'
import { useVerifiedValues } from '@/hooks/useVerifiedValues'
import { useLeadFields } from '@/hooks/useLeadFields'

const UPDATABLE_FIELDS = [
  { value: 'city',                label: 'City' },
  { value: 'state',               label: 'State' },
  { value: 'country',             label: 'Country' },
  { value: 'nationality',         label: 'Nationality' },
  { value: 'source',              label: 'Source' },
  { value: 'event',               label: 'Event' },
  { value: 'intrestedCourse',     label: 'Product interest' },
  { value: 'website',             label: 'Website' },
]

type Tab = 'update' | 'verified'

function UpdateLeadsForm() {
  const queryClient = useQueryClient()
  const { filterFields } = useLeadFields()
  // A field the customer cannot see should not be bulk-editable either. The
  // backend refuses it too, so this is convenience rather than the guard.
  const updatableFields = useMemo(
    () => filterFields(UPDATABLE_FIELDS, 'value'),
    [filterFields],
  )
  const [selectedField, setSelectedField] = useState('')
  const [selectedOldValues, setSelectedOldValues] = useState<Set<string>>(new Set())
  const [newValue, setNewValue] = useState('')
  const [searchOld, setSearchOld] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { isVerified } = useVerifiedValues()

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const fieldLabel = updatableFields.find((f) => f.value === selectedField)?.label ?? selectedField

  const { data: fieldValues = [], isLoading: valuesLoading } = useQuery<{value: string; count: number}[]>({
    queryKey: ['field-values', selectedField, true],
    queryFn: () => leadsApi.fieldValues(selectedField, true),
    enabled: !!selectedField,
  })

  const filteredValues = fieldValues.filter((v) =>
    !searchOld || v.value.toLowerCase().includes(searchOld.toLowerCase())
  )

  const fieldUpdate = useMutation({
    mutationFn: (approvedLeadIds: number[]) =>
      leadsApi.fieldUpdate({
        field: selectedField,
        oldValues: Array.from(selectedOldValues),
        newValue: newValue.trim(),
        approvedLeadIds: approvedLeadIds.length ? approvedLeadIds : undefined,
      }),
    onSuccess: (data) => {
      toast.success(data.count + ' leads updated successfully')
      setSelectedOldValues(new Set())
      setNewValue('')
      setShowPreview(false)
      queryClient.invalidateQueries({ queryKey: ['bulk-ops-field-update'] })
      queryClient.invalidateQueries({ queryKey: ['field-values', selectedField] })
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to update leads'),
  })

  const toggleOldValue = (val: string) => {
    const next = new Set(selectedOldValues)
    if (next.has(val)) next.delete(val); else next.add(val)
    setSelectedOldValues(next)
  }

  const selectAllFiltered = () => {
    const next = new Set(selectedOldValues)
    filteredValues.forEach((v) => next.add(v.value))
    setSelectedOldValues(next)
  }

  const clearSelection = () => setSelectedOldValues(new Set())

  const canPreview = selectedField && selectedOldValues.size > 0 && newValue.trim()

  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Step 1: Select Field */}
        <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b bg-gradient-to-r from-orange-50/80 to-transparent">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs font-bold">1</span>
              Select Field
            </h3>
          </div>
          <div className="p-4 space-y-2">
            {updatableFields.map((f) => (
              <button key={f.value}
                onClick={() => { setSelectedField(f.value); setSelectedOldValues(new Set()); setSearchOld('') }}
                className={'w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-between ' + (
                  selectedField === f.value
                    ? 'bg-orange-50 border border-orange-200 text-orange-700 shadow-sm'
                    : 'hover:bg-muted/50 text-muted-foreground border border-transparent'
                )}>
                <span className="flex items-center gap-2">
                  <Database className={'h-3.5 w-3.5 ' + (selectedField === f.value ? 'text-orange-500' : 'text-muted-foreground/40')} />
                  {f.label}
                </span>
                {selectedField === f.value && <CheckCircle2 className="h-4 w-4 text-orange-500" />}
              </button>
            ))}
          </div>
        </div>

        {/* Step 2: Select Old Values */}
        <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b bg-gradient-to-r from-blue-50/80 to-transparent">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold">2</span>
              Select Old Values
              {selectedOldValues.size > 0 && (
                <span className="px-2 py-0.5 text-xs font-bold bg-blue-100 text-blue-700 rounded-full">{selectedOldValues.size} selected</span>
              )}
            </h3>
          </div>
          <div className="p-4 space-y-3">
            {!selectedField ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <ChevronDown className="h-6 w-6 mx-auto mb-2 text-muted-foreground/30" />
                Select a field first
              </div>
            ) : valuesLoading ? (
              <div className="py-8 text-center">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-500" />
                <p className="text-sm text-muted-foreground mt-2">Loading values...</p>
              </div>
            ) : fieldValues.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No values found for this field</div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input value={searchOld} onChange={(e) => setSearchOld(e.target.value)}
                    placeholder="Filter values..."
                    className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-muted/30 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <button onClick={selectAllFiltered} className="text-blue-600 hover:underline font-medium">
                    Select all ({filteredValues.length})
                  </button>
                  <span className="text-muted-foreground">|</span>
                  <button onClick={clearSelection} className="text-muted-foreground hover:text-foreground font-medium">Clear</button>
                </div>
                <div className="max-h-[320px] overflow-y-auto space-y-1 custom-scrollbar">
                  {filteredValues.map((valObj) => {
                    const val = valObj.value
                    return (
                    <label key={val}
                      className={'flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ' + (
                        selectedOldValues.has(val) ? 'bg-blue-50 text-blue-700' : 'hover:bg-muted/40'
                      )}>
                      <input type="checkbox" checked={selectedOldValues.has(val)} onChange={() => toggleOldValue(val)}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      <span className="truncate flex-1">{val} <span className="text-muted-foreground ml-1">({valObj.count})</span></span>
                      {isVerified(selectedField, val) && (
                        <BadgeCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      )}
                    </label>
                  )})}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Step 3: New Value + Preview */}
        <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b bg-gradient-to-r from-emerald-50/80 to-transparent">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold">3</span>
              Replace With
            </h3>
          </div>
          <div className="p-4 space-y-4">
            {selectedOldValues.size > 0 && (
              <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Replacing</p>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from(selectedOldValues).slice(0, 5).map((v) => (
                    <span key={v} className="px-2 py-0.5 text-xs bg-red-50 text-red-600 border border-red-200 rounded-full font-medium truncate max-w-[140px] inline-flex items-center gap-1">
                      {v}
                      {isVerified(selectedField, v) && <BadgeCheck className="h-3 w-3 text-emerald-500" />}
                    </span>
                  ))}
                  {selectedOldValues.size > 5 && (
                    <span className="px-2 py-0.5 text-xs text-muted-foreground">+{selectedOldValues.size - 5} more</span>
                  )}
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground mx-auto" />
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 block">New Value</label>
              <div className="relative" ref={dropdownRef}>
                <input 
                  value={newValue} 
                  onChange={(e) => { setNewValue(e.target.value); setShowDropdown(true); }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="Enter or select replacement value"
                  className="w-full px-3 py-2.5 bg-muted/30 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50" 
                />
                {showDropdown && fieldValues.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-card border rounded-lg shadow-lg max-h-60 overflow-auto custom-scrollbar">
                    {fieldValues
                      .filter(v => v.value.toLowerCase().includes(newValue.toLowerCase()))
                      .map(v => (
                        <div 
                          key={v.value} 
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setNewValue(v.value);
                            setShowDropdown(false);
                          }}
                          className="px-3 py-2 text-sm hover:bg-muted/50 cursor-pointer flex items-center justify-between transition-colors"
                        >
                          <div className="flex items-center gap-2 truncate pr-2">
                            <span className="truncate">{v.value}</span>
                            {isVerified(selectedField, v.value) && <BadgeCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{v.count} leads</span>
                        </div>
                    ))}
                    {fieldValues.filter(v => v.value.toLowerCase().includes(newValue.toLowerCase())).length === 0 && (
                      <div className="px-3 py-3 text-sm text-center text-muted-foreground">No matches found</div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <button onClick={() => setShowPreview(true)} disabled={!canPreview}
              className={'w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ' + (
                canPreview
                  ? 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white shadow-sm shadow-orange-500/20'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}>
              <Eye className="h-4 w-4" />
              Preview Changes
            </button>
            {!selectedField && <p className="text-xs text-muted-foreground text-center">Select a field and values to begin</p>}
            {selectedField && selectedOldValues.size === 0 && <p className="text-xs text-muted-foreground text-center">Select at least one old value</p>}
            {selectedField && selectedOldValues.size > 0 && !newValue.trim() && <p className="text-xs text-muted-foreground text-center">Enter the new replacement value</p>}
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <p className="font-semibold mb-1">How it works</p>
          <p className="text-amber-700 text-xs leading-relaxed">
            Click <strong>Preview Changes</strong> to see exactly which leads will be affected with old {'→'} new values (100 per page).
            Review, select or deselect individual leads, then <strong>Approve</strong>. Every update is logged below with undo capability.
          </p>
        </div>
      </div>

      <FieldUpdateLogs />

      {showPreview && (
        <BulkPreviewModal
          filterField={selectedField}
          filterFieldLabel={fieldLabel}
          writeField={selectedField}
          writeFieldLabel={fieldLabel}
          filterValues={Array.from(selectedOldValues)}
          newValue={newValue.trim()}
          onClose={() => setShowPreview(false)}
          onApprove={(approvedIds) => fieldUpdate.mutate(approvedIds)}
          isApproving={fieldUpdate.isPending}
        />
      )}
    </div>
  )
}

export default function UpdateLeads() {
  const [tab, setTab] = useState<Tab>(() => {
    const p = new URLSearchParams(window.location.search).get('tab')
    return p === 'verified' ? 'verified' : 'update'
  })

  const switchTab = (t: Tab) => {
    setTab(t)
    const url = new URL(window.location.href)
    if (t === 'update') url.searchParams.delete('tab')
    else url.searchParams.set('tab', t)
    window.history.replaceState({}, '', url.toString())
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <RefreshCw className="h-5 w-5 text-white" />
            </div>
            {tab === 'update' ? 'Update Leads' : 'Verified Data'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 ml-[46px]">
            {tab === 'update'
              ? 'Find and replace field values across leads — with preview and undo'
              : 'Mark canonical city/state/source values as verified. Green tick appears wherever these values are shown.'}
          </p>
        </div>
      </div>

      <div className="border-b flex items-center gap-6">
        <button onClick={() => switchTab('update')}
          className={'py-3 px-1 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-2 ' + (
            tab === 'update' ? 'border-orange-500 text-orange-600' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}>
          <RefreshCw className="h-4 w-4" /> Update Leads
        </button>
        <button onClick={() => switchTab('verified')}
          className={'py-3 px-1 text-sm font-semibold border-b-2 -mb-px transition-colors flex items-center gap-2 ' + (
            tab === 'verified' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}>
          <BadgeCheck className="h-4 w-4" /> Verified Data
        </button>
      </div>

      {tab === 'update' ? <UpdateLeadsForm /> : <VerifiedData />}
    </div>
  )
}
