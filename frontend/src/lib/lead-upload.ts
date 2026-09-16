import * as XLSX from 'xlsx'
import type { LeadStagingUploadRow } from './api'
import { normalizePhone } from './utils'

const PHONE_FIELDS: Array<keyof LeadStagingUploadRow> = [
  'phone', 'mobile2', 'mobile3', 'fatherMobile', 'motherMobile',
]

export const TEMPLATE_HEADERS = [
  'Name', 'Father', 'Mother',
  'Email', 'Email2', 'Email3',
  'Mobile', 'Mobile2', 'Mobile3',
  'Father Mobile', 'Mother Mobile',
  'City', 'State', 'Country', 'Pincode',
  'DOB', 'Gender', 'Nationality',
  'Intrested Course', 'Intrested University',
  'Event', 'Source', 'Lead Type', 'Comment',
]

export function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    [
      'John Doe', '', '',
      'john@example.com', '', '',
      '9876543210', '', '',
      '', '',
      'Delhi', 'Delhi', 'INDIA', '',
      '', '', '',
      '', '',
      '', '', 'new', '',
    ],
  ])
  ws['!cols'] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(12, h.length + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Leads')
  XLSX.writeFile(wb, 'lead-upload-template.xlsx')
}

const COLUMN_ALIASES: Record<keyof LeadStagingUploadRow, string[]> = {
  name: ['name', 'fullname', 'leadname', 'studentname'],
  email: ['email', 'emailid', 'emailaddress', 'email1', 'primaryemail'],
  phone: ['phone', 'mobile', 'contact', 'phonenumber', 'mobilenumber', 'mobile1', 'primarymobile'],
  father: ['father', 'fathername'],
  mother: ['mother', 'mothername'],
  email2: ['email2', 'secondaryemail', 'altemail', 'alternateemail'],
  email3: ['email3', 'tertiaryemail'],
  mobile2: ['mobile2', 'secondarymobile', 'altmobile', 'alternatemobile', 'phone2'],
  mobile3: ['mobile3', 'tertiarymobile', 'phone3'],
  fatherMobile: ['fathermobile', 'fatherphone', 'fathercontact'],
  motherMobile: ['mothermobile', 'motherphone', 'mothercontact'],
  city: ['city'],
  state: ['state'],
  country: ['country'],
  pincode: ['pincode', 'pin', 'zip', 'zipcode', 'postalcode'],
  dob: ['dob', 'dateofbirth', 'birthdate'],
  gender: ['gender', 'sex'],
  nationality: ['nationality'],
  intrestedCourse: ['intrestedcourse', 'interestedcourse', 'course'],
  intrestedUniversity: ['intresteduniversity', 'interesteduniversity', 'university'],
  event: ['event'],
  source: ['source'],
  leadType: ['leadtype', 'type'],
  leadComment: ['comment', 'comments', 'note', 'notes', 'remark', 'remarks'],
}

export function parseLeadExcel(file: File): Promise<LeadStagingUploadRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
        const items: LeadStagingUploadRow[] = rows.map((row) => {
          const obj: Record<string, string> = {}
          for (const k of Object.keys(row)) obj[normalize(k)] = String(row[k] ?? '').trim()
          const out: Record<string, string> = { name: '' }
          for (const field of Object.keys(COLUMN_ALIASES) as (keyof LeadStagingUploadRow)[]) {
            for (const alias of COLUMN_ALIASES[field]) {
              if (obj[alias]) { out[field] = obj[alias]; break }
            }
          }
          for (const f of PHONE_FIELDS) {
            if (out[f]) out[f] = normalizePhone(out[f])
          }
          return out as unknown as LeadStagingUploadRow
        }).filter((r) =>
          r.name || r.email || r.phone || r.email2 || r.email3 ||
          r.mobile2 || r.mobile3 || r.fatherMobile || r.motherMobile,
        )
        resolve(items)
      } catch (err) {
        reject(err)
      }
    }
    reader.readAsArrayBuffer(file)
  })
}
