import React, { useState, useRef, useMemo } from 'react'
import { useLeadFields } from '@/hooks/useLeadFields'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { leadsApi, leadConfigApi } from '@/lib/api'
import { normalizePhone } from '@/lib/utils'
import { toast } from 'sonner'
import { Loader2, ArrowLeft, Upload, FileText } from 'lucide-react'
import * as XLSX from 'xlsx'
import type { LeadDepartment } from '@/types'

/**
 * CSV headers, paired with the field key each one maps to.
 *
 * The pairing exists so the template and the help text can drop whatever the
 * customer has switched off. Offering a B2B customer a `father` and
 * `intrested_university` column — and generating a template with them in it —
 * teaches people to fill in fields their own CRM will never show them again.
 *
 * `null` means the column has no field key and is always offered: `event`,
 * `source` and `lead_type` drive the pipeline itself, not the lead form.
 */
const TEMPLATE_COLUMNS: [column: string, fieldKey: string | null][] = [
  ['name', 'name'],
  ['father', 'father'],
  ['mother', 'mother'],
  ['email', 'email'],
  ['email2', 'email2'],
  ['email3', 'email3'],
  ['mobile', 'mobile'],
  ['mobile2', 'mobile2'],
  ['mobile3', 'mobile3'],
  ['father_mobile', 'fatherMobile'],
  ['mother_mobile', 'motherMobile'],
  ['city', 'city'],
  ['state', 'state'],
  ['country', 'country'],
  ['pincode', 'pincode'],
  ['dob', 'dob'],
  ['gender', 'gender'],
  ['nationality', 'nationality'],
  ['intrested_course', 'intrestedCourse'],
  ['intrested_university', 'intrestedUniversity'],
  ['event', null],
  ['source', null],
  ['lead_type', null],
  ['comment', null],
]

/**
 * Fallback lead types.
 *
 * Only used if the customer's own `lead_types` table cannot be read. The list
 * was hardcoded here — NEET Appearing, NEET Qualified, Admission Drop — which
 * meant a B2B customer picking a lead type was choosing from a medical
 * admissions vocabulary. Their real types are seeded from their vertical
 * (Inbound, Outbound, Referral, Partner…) and are now read from the database.
 */
const FALLBACK_LEAD_TYPES = [
  { value: 'new', label: 'New' },
  { value: 'not-interested', label: 'Not Interested' },
]

const INDIA_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan',
  'Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Delhi','Jammu & Kashmir','Ladakh','Chandigarh','Puducherry',
]

export function AddLead() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  // Offer only the columns this customer actually has. A B2B customer being
  // handed a template with `father` and `intrested_university` in it is being
  // invited to collect data their own CRM will never show them again.
  const { visible: fieldVisible } = useLeadFields()
  const templateColumns = useMemo(
    () => TEMPLATE_COLUMNS.filter(([, key]) => !key || fieldVisible(key)).map(([col]) => col),
    [fieldVisible],
  )

  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvImporting, setCsvImporting] = useState(false)

  const [form, setForm] = useState({
    name: '',
    father: '',
    mother: '',
    email: '',
    email2: '',
    email3: '',
    mobile: '',
    mobile2: '',
    mobile3: '',
    fatherMobile: '',
    motherMobile: '',
    city: '',
    state: '',
    country: 'INDIA',
    pincode: '',
    intrestedCourse: '',
    event: '',
    leadType: 'new',
    departmentId: '',
    comment: '',
  })

  const { data: departments = [] } = useQuery<LeadDepartment[]>({
    queryKey: ['lead-config', 'departments'],
    queryFn: leadConfigApi.departments,
  })

  const { data: dbLeadTypes } = useQuery({
    queryKey: ['lead-config', 'types'],
    queryFn: leadConfigApi.types,
    staleTime: 60 * 60_000,
  })

  const leadTypes = dbLeadTypes?.length
    ? dbLeadTypes.map((t) => ({ value: t.slug, label: t.title }))
    : FALLBACK_LEAD_TYPES

  const create = useMutation({
    mutationFn: () =>
      leadsApi.create({
        ...form,
        departmentId: form.departmentId ? Number(form.departmentId) : undefined,
        email: form.email || undefined,
        email2: form.email2 || undefined,
        email3: form.email3 || undefined,
        mobile: normalizePhone(form.mobile) || undefined,
        mobile2: normalizePhone(form.mobile2) || undefined,
        mobile3: normalizePhone(form.mobile3) || undefined,
        fatherMobile: normalizePhone(form.fatherMobile) || undefined,
        motherMobile: normalizePhone(form.motherMobile) || undefined,
        source: form.event || undefined,
        event: form.event || undefined,
      }),
    onSuccess: (data) => {
      toast.success('Lead created successfully!')
      navigate({ to: '/app/leads/$leadId', params: { leadId: String(data.id) } })
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error
        || err?.response?.data?.message
        || err?.message
        || 'Failed to create lead'
      toast.error(typeof msg === 'string' ? msg : JSON.stringify(msg))
    },
  })

  const set = (field: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }))

  // CSV / Excel Import
  const handleCsvImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!csvFile) return
    setCsvImporting(true)
    try {
      const buf = await csvFile.arrayBuffer()
      const workbook = XLSX.read(buf, { type: 'array' })
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
        defval: '', raw: false,
      })
      // Normalise to string-only rows; drop rows missing all of name/mobile/email.
      const leads = rawRows
        .map((row) => {
          const out: Record<string, string> = {}
          for (const [k, v] of Object.entries(row)) {
            out[k.trim().toLowerCase().replace(/[\s-]/g, '_')] =
              v == null ? '' : String(v).trim()
          }
          return out
        })
        .filter((r) => r.name || r.mobile || r.email)

      if (!leads.length) {
        toast.error('No valid rows found. Check that you have a "name" column.')
        return
      }

      const result = await leadsApi.import(leads)
      toast.success(result.message || `${leads.length} leads imported`)
      setCsvFile(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Import failed'
      toast.error(`Import failed: ${msg}`)
    } finally {
      setCsvImporting(false)
    }
  }

  // Excel template download — generates an .xlsx with header row + 1 example row
  const downloadExcelTemplate = () => {
    const exampleRow: Record<string, string> = {}
    templateColumns.forEach((c: string) => { exampleRow[c] = '' })
    exampleRow.name = 'John Doe'
    exampleRow.email = 'john@example.com'
    exampleRow.mobile = '9876543210'
    exampleRow.city = 'Delhi'
    exampleRow.state = 'Delhi'
    exampleRow.country = 'INDIA'
    exampleRow.lead_type = 'new'

    const ws = XLSX.utils.json_to_sheet([exampleRow], { header: templateColumns })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Leads')
    XLSX.writeFile(wb, 'leads-import-template.xlsx')
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate({ to: '/app/leads' })}
          className="p-1.5 rounded-md hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-xl font-bold text-red-600">Add Leads</h1>
      </div>

      {/* CSV Import Section */}
      <div className="bg-card border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Import via CSV</h2>
        </div>
        <form onSubmit={handleCsvImport}>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Select CSV File</label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                required
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
            </div>
            <button
              type="submit"
              disabled={csvImporting || !csvFile}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {csvImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {csvImporting ? 'Importing...' : 'Import File'}
            </button>
            <button
              type="button"
              onClick={downloadExcelTemplate}
              className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              Download Excel Template
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Accepts <strong>.xlsx</strong>, <strong>.xls</strong>, or <strong>.csv</strong>. Required column: <code>name</code>. Optional: {templateColumns.filter((c: string) => c !== 'name').join(', ')}
          </p>
        </form>
      </div>

      {/* Manual Entry Form */}
      <div className="bg-card border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-4">Add Manually</h2>

        <div className="space-y-4">
          {/* Row 1 — Names */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field name="name" label="Contact Name">
              <input value={form.name} onChange={set('name')} placeholder="Enter contact name" className={inputCls} />
            </Field>
            <Field name="father" label="Father Name">
              <input value={form.father} onChange={set('father')} placeholder="Enter Father Name" className={inputCls} />
            </Field>
            <Field name="mother" label="Mother Name">
              <input value={form.mother} onChange={set('mother')} placeholder="Enter Mother Name" className={inputCls} />
            </Field>
          </div>

          {/* Row 2 — Emails */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field name="email" label="Work Email">
              <input type="email" value={form.email} onChange={set('email')} placeholder="Enter work email" className={inputCls} />
            </Field>
            <Field name="email2" label="Email 2">
              <input type="email" value={form.email2} onChange={set('email2')} placeholder="Enter second email" className={inputCls} />
            </Field>
            <Field name="email3" label="Email 3 (Other)">
              <input type="email" value={form.email3} onChange={set('email3')} placeholder="Enter other email (optional)" className={inputCls} />
            </Field>
          </div>

          {/* Row 3 — Mobiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field name="mobile" label="Mobile (with country code)">
              <input value={form.mobile} onChange={set('mobile')} placeholder="Enter mobile number" className={inputCls} />
            </Field>
            <Field name="mobile2" label="Mobile 2">
              <input value={form.mobile2} onChange={set('mobile2')} placeholder="Enter second mobile" className={inputCls} />
            </Field>
            <Field name="mobile3" label="Mobile 3 (optional)">
              <input value={form.mobile3} onChange={set('mobile3')} placeholder="Enter other Mobile (optional)" className={inputCls} />
            </Field>
          </div>

          {/* Row 4 — Location */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field name="city" label="City">
              <input value={form.city} onChange={set('city')} placeholder="Enter City" className={inputCls} />
            </Field>
            <Field name="state" label="State">
              <select value={form.state} onChange={set('state')} className={inputCls}>
                <option value="">Select State</option>
                {INDIA_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field name="country" label="Country">
              <input value={form.country} onChange={set('country')} placeholder="Country" list="country-list" className={inputCls} />
              <datalist id="country-list">
                <option value="INDIA" /><option value="USA" /><option value="UK" />
                <option value="Canada" /><option value="Australia" /><option value="UAE" />
                <option value="Germany" /><option value="France" /><option value="Singapore" />
              </datalist>
            </Field>
          </div>

          {/* Row 5 — More details */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field name="pincode" label="Pincode">
              <input value={form.pincode} onChange={set('pincode')} placeholder="Enter PinCode (optional)" pattern="[0-9]{2,30}" className={inputCls} />
            </Field>
            <Field name="intrestedCourse" label="Product interest">
              <input value={form.intrestedCourse} onChange={set('intrestedCourse')} placeholder="Enter product interest" className={inputCls} />
            </Field>
            <Field name="source" label="Source">
              <input value={form.event} onChange={set('event')} placeholder="Enter Source (e.g. Facebook)" list="source-list" className={inputCls} />
              <datalist id="source-list">
                <option value="Facebook" /><option value="Google" /><option value="Website" />
                <option value="Walk-in" /><option value="Referral" /><option value="Instagram" />
                <option value="WhatsApp" /><option value="YouTube" /><option value="Email" />
              </datalist>
            </Field>
          </div>

          {/* Row 6 — Lead Type + Department */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field name="leadType" label="Lead Type">
              <select value={form.leadType} onChange={set('leadType')} className={inputCls}>
                {leadTypes.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Department">
              <select value={form.departmentId} onChange={set('departmentId')} className={inputCls}>
                <option value="">Select Department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Comment */}
          <Field label="Comment">
            <textarea
              value={form.comment}
              onChange={set('comment')}
              placeholder="Type here"
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </Field>

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => create.mutate()}
              disabled={create.isPending || !form.name.trim()}
              className="px-6 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 font-medium"
            >
              {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add Lead
            </button>
            <button
              onClick={() => navigate({ to: '/app/leads' })}
              className="px-6 py-2 text-sm border rounded-md hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'w-full px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring'

function Field({
  name,
  label,
  required,
  children,
}: {
  /**
   * Lead field key. When given, this Field disappears if a super admin has
   * switched the field off for this customer. Omit it for inputs that are not
   * lead columns (Department, Comment) — those are always shown.
   */
  name?: string
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  const { visible, label: renamed } = useLeadFields()
  if (name && !visible(name)) return null

  // Renaming is applied HERE rather than at each of the sixteen call sites, so
  // a field added later cannot quietly ship the education wording. `label` is
  // the fallback: what a customer who has renamed nothing still sees.
  const heading = name ? renamed(name, label) : label

  /**
   * The placeholder has to follow the label.
   *
   * Every input here carries hand-written copy — "Enter Student name", "Enter
   * Father Name" — which only the heading was going through the config. A B2B
   * customer therefore saw a correctly renamed label sitting on top of a box
   * that still said "Enter Student name".
   *
   * So: when a customer has RENAMED the field, the placeholder is regenerated
   * from the new label. When they have not, the crafted copy is left exactly as
   * written — which is why nothing changes for an education customer.
   */
  const wasRenamed = heading !== label
  const child =
    wasRenamed && React.isValidElement(children)
      ? React.cloneElement(children as React.ReactElement<{ placeholder?: string }>, {
          placeholder: `Enter ${heading}`,
        })
      : children

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">
        {heading}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {child}
    </div>
  )
}
