// ─────────────────────────────────────────────────────────────────────────────
// The catalogue of lead fields a super admin can show or hide per customer.
//
// This is the single source of truth. The super admin panel builds its toggle
// grid from it, the customer app filters its Lead Information tab by it, and
// both read the same list — so they cannot drift apart.
//
// WHAT THIS IS NOT
//
// Visibility, not access control, and not a schema change. Hiding a field:
//   • does NOT drop the column or delete any value
//   • does NOT stop the API returning it
// Turn a field back on and the data that was there is still there. That is the
// point: a customer who does not do UK admissions should not scroll past twelve
// empty UCAT boxes, but nothing about their data changes if they start next year.
//
// Every field is ON by default, so existing customers see no change at all.
// ─────────────────────────────────────────────────────────────────────────────

export interface LeadFieldDef {
  /** Property name on the Lead model. */
  key: string
  label: string
  /** Rendered as a number input when editing. */
  type?: 'number'
}

export interface LeadFieldGroup {
  /** Stable id used in the stored config — never change it once shipped. */
  id: string
  title: string
  /**
   * Groups that make no sense to hide. A lead with no name is not a lead, and
   * "Other Settings" carries the pipeline fields (lead type, source, website)
   * the CRM itself runs on.
   */
  locked?: boolean
  fields: LeadFieldDef[]
}

export const LEAD_FIELD_GROUPS: LeadFieldGroup[] = [
  {
    id: 'personal',
    title: 'Personal Information',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'father', label: 'Father' },
      { key: 'mother', label: 'Mother' },
      { key: 'email', label: 'Email' },
      { key: 'email2', label: 'Email 2 (Father)' },
      { key: 'email3', label: 'Email 3 (Other)' },
      { key: 'mobile', label: 'Mobile' },
      { key: 'mobile2', label: 'Mobile 2 (Father)' },
      { key: 'mobile3', label: 'Mobile 3 (Other)' },
      { key: 'fatherMobile', label: 'Father Mobile' },
      { key: 'motherMobile', label: 'Mother Mobile' },
      { key: 'gender', label: 'Gender' },
      { key: 'dob', label: 'DOB' },
      { key: 'firstLanguage', label: 'First Language' },
      { key: 'maritalStatus', label: 'Marital Status' },
      { key: 'castCategory', label: 'Cast Category' },
      { key: 'nationality', label: 'Nationality' },
      { key: 'religion', label: 'Religion' },
      { key: 'passportNumber', label: 'Passport No.' },
      { key: 'passportExpiry', label: 'Passport Expiry' },
    ],
  },
  {
    id: 'address',
    title: 'Address Detail',
    fields: [
      { key: 'homeAddress', label: 'Home Address' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State' },
      { key: 'country', label: 'Country' },
      { key: 'pincode', label: 'Pincode' },
      { key: 'homeContactNumber', label: 'Home Contact Number' },
    ],
  },
  {
    id: 'education',
    title: 'Education Summary',
    fields: [
      { key: 'countryOfEducation', label: 'Country of Education' },
      { key: 'highestQualification', label: 'Highest Qualification' },
      { key: 'highestLevelOfEducation', label: 'Highest Level of Education' },
      { key: 'gradingScheme', label: 'Grading Scheme' },
      { key: 'gradeAverage', label: 'Grade Average' },
    ],
  },
  {
    id: 'neet',
    title: 'NEET Scores',
    fields: [
      { key: 'studentType', label: 'Student Type' },
      { key: 'neetRank', label: 'NEET Rank' },
      { key: 'neetQualified', label: 'NEET Qualified' },
      { key: 'neetPassingYear', label: 'NEET Passing Year', type: 'number' },
      { key: 'neetResult', label: 'NEET Result' },
    ],
  },
  {
    id: 'english',
    title: 'English Test Scores',
    fields: [
      { key: 'englishExamType', label: 'Exam Type' },
      { key: 'dateOfExam', label: 'Date of Exam' },
      { key: 'listeningScore', label: 'Listening Score' },
      { key: 'readingScore', label: 'Reading Score' },
      { key: 'writingScore', label: 'Writing Score' },
      { key: 'speakingScore', label: 'Speaking Score' },
      { key: 'overallScore', label: 'Overall Score', type: 'number' },
    ],
  },
  {
    id: 'academics',
    title: '10th / 12th / UG',
    fields: [
      { key: 'hs', label: '10th' },
      { key: 'hsSchoolName', label: '10th School Name' },
      { key: 'hsPassingYear', label: '10th Passing Year' },
      { key: 'hsResult', label: '10th Result' },
      { key: 'intr', label: '12th' },
      { key: 'intrSchoolName', label: '12th School Name' },
      { key: 'intrPassingYear', label: '12th Passing Year' },
      { key: 'intrResult', label: '12th Result' },
      { key: 'ug', label: 'UG' },
      { key: 'ugSchoolName', label: 'UG School Name' },
      { key: 'ugPassingYear', label: 'UG Passing Year' },
      { key: 'ugResult', label: 'UG Result' },
    ],
  },
  {
    id: 'ucat',
    title: 'UCAT',
    fields: [
      { key: 'ucat', label: 'UCAT (1=Yes)', type: 'number' },
      { key: 'ucatExamDate', label: 'Exam Date' },
      { key: 'ucatVScore', label: 'V Score' },
      { key: 'ucatVRank', label: 'V Rank' },
      { key: 'ucatQScore', label: 'Q Score' },
      { key: 'ucatQRank', label: 'Q Rank' },
      { key: 'ucatWScore', label: 'W Score' },
      { key: 'ucatWRank', label: 'W Rank' },
    ],
  },
  {
    id: 'dmat',
    title: 'DMAT',
    fields: [
      { key: 'dmat', label: 'DMAT (1=Yes)', type: 'number' },
      { key: 'dmatExamDate', label: 'Exam Date' },
      { key: 'dmatVScore', label: 'V Score' },
      { key: 'dmatVRank', label: 'V Rank' },
      { key: 'dmatQScore', label: 'Q Score' },
      { key: 'dmatQRank', label: 'Q Rank' },
      { key: 'dmatWScore', label: 'W Score' },
      { key: 'dmatWRank', label: 'W Rank' },
      { key: 'dmatIrScore', label: 'IR Score' },
      { key: 'dmatIrRank', label: 'IR Rank' },
      { key: 'dmatTotalScore', label: 'Total Score' },
      { key: 'dmatTotalRank', label: 'Total Rank' },
    ],
  },
  {
    id: 'sat',
    title: 'SAT',
    fields: [
      { key: 'sat', label: 'SAT (1=Yes)', type: 'number' },
      { key: 'satExamDate', label: 'Exam Date' },
      { key: 'satReasoningPoints', label: 'Reasoning Points' },
      { key: 'satSubjectPoints', label: 'Subject Points' },
    ],
  },
  {
    id: 'other',
    title: 'Other Settings',
    // Lead type, source and website drive assignment, filtering and reporting.
    locked: true,
    fields: [
      { key: 'leadType', label: 'Lead Type' },
      { key: 'website', label: 'Website' },
      { key: 'source', label: 'Source' },
      { key: 'intrestedCourse', label: 'Course' },
      { key: 'intrestedUniversity', label: 'University' },
      { key: 'intrestedSubject', label: 'Subject' },
      { key: 'approximateBudget', label: 'Budget' },
    ],
  },
]

/** Fields that stay visible whatever the config says. */
export const ALWAYS_ON_FIELDS = new Set(['name', 'email', 'mobile'])

const ALL_FIELD_KEYS = new Set(LEAD_FIELD_GROUPS.flatMap((g) => g.fields.map((f) => f.key)))
const LOCKED_GROUP_IDS = new Set(LEAD_FIELD_GROUPS.filter((g) => g.locked).map((g) => g.id))

/**
 * A customer's stored config. Only deviations from "everything on" are stored,
 * so adding a field to the catalogue never needs a migration and never
 * retroactively hides anything.
 */
export interface LeadFieldConfig {
  /** Group ids switched off wholesale. */
  hiddenGroups: string[]
  /** Individual field keys switched off. */
  hiddenFields: string[]
  /**
   * Per-customer renames: { "intrestedCourse": "Product / Service" }.
   *
   * Renaming is presentation only — the Prisma property and the column keep
   * their names, so `intrestedCourse` is still `intrestedCourse` in every query,
   * import and API response. That mismatch is the price of not migrating a
   * 63k-row table to make a heading read better, and it is the right trade.
   */
  labels?: Record<string, string>
  /** The same, for group headings: { "other": "Deal Details" }. */
  groupLabels?: Record<string, string>
}

export const EMPTY_LEAD_FIELD_CONFIG: LeadFieldConfig = { hiddenGroups: [], hiddenFields: [] }

/**
 * MEASURED ON THE LIVE DATABASE (63,539 leads), for whoever decides what a new
 * customer should keep. Recorded, deliberately NOT acted on — every customer
 * starts with all 86 fields until somebody chooses otherwise.
 *
 *   DMAT                12 fields    0 leads have any data
 *   SAT                  4 fields    0 leads
 *   UCAT                 8 fields    2 leads
 *   English Test Scores  7 fields   17 leads
 *   Education Summary    5 fields  228 leads (0.36%)
 *   10th / 12th / UG    12 fields  2,220 leads — this one IS used
 */
export const MEASURED_EMPTY_GROUPS = ['dmat', 'sat', 'ucat', 'english', 'education'] as const

const ALL_GROUP_IDS = new Set(LEAD_FIELD_GROUPS.map((g) => g.id))

/**
 * Keep only known keys, and only non-empty renames. A blank label would render
 * a nameless input, which is worse than the default it replaced.
 */
function sanitizeRenames(input: unknown, allowed: Set<string>): Record<string, string> {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const out: Record<string, string> = {}

  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key)) continue
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) out[key] = trimmed.slice(0, 60)
  }

  return out
}

/** Drop unknown keys and anything that may not be hidden. */
export function sanitizeLeadFieldConfig(input: unknown): LeadFieldConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>

  const groups = Array.isArray(raw.hiddenGroups) ? raw.hiddenGroups : []
  const fields = Array.isArray(raw.hiddenFields) ? raw.hiddenFields : []

  const labels = sanitizeRenames(raw.labels, ALL_FIELD_KEYS)
  const groupLabels = sanitizeRenames(raw.groupLabels, ALL_GROUP_IDS)

  const config: LeadFieldConfig = {
    hiddenGroups: [...new Set(groups.filter((g): g is string => typeof g === 'string'))]
      .filter((g) => ALL_GROUP_IDS.has(g))
      .filter((g) => !LOCKED_GROUP_IDS.has(g)),
    hiddenFields: [...new Set(fields.filter((f): f is string => typeof f === 'string'))]
      .filter((f) => ALL_FIELD_KEYS.has(f))
      .filter((f) => !ALWAYS_ON_FIELDS.has(f)),
  }

  // Omitted rather than set empty, so a customer who has renamed nothing stores
  // the same `{}` they always did and nothing downstream sees a shape change.
  if (Object.keys(labels).length) config.labels = labels
  if (Object.keys(groupLabels).length) config.groupLabels = groupLabels

  return config
}

/**
 * EVERY field key hidden for a customer — by its own flag OR by its group.
 *
 * The stored config keeps groups and fields separate, which is right for
 * editing: hiding "NEET Scores" should stay one checkbox, not five. But it
 * makes the client's job a footgun — `visible('neetQualified')` has to be told
 * that the field lives in the `neet` group, and a caller who forgets silently
 * renders a field the customer switched off.
 *
 * So the server flattens it once, here, and ships the answer. The client then
 * needs no catalogue of its own and cannot get it wrong.
 */
export function hiddenFieldKeys(stored: unknown): string[] {
  const config = sanitizeLeadFieldConfig(stored)
  const hiddenGroups = new Set(config.hiddenGroups)
  const out = new Set(config.hiddenFields)

  for (const group of LEAD_FIELD_GROUPS) {
    if (!hiddenGroups.has(group.id)) continue
    for (const f of group.fields) {
      if (!ALWAYS_ON_FIELDS.has(f.key)) out.add(f.key)
    }
  }

  return [...out]
}

/**
 * Is one field visible for a customer, given their stored config?
 *
 * The server-side counterpart of the frontend's useLeadFields hook — used to
 * refuse writes to a field the customer cannot see, so the UI is not the only
 * thing enforcing it.
 */
export function isLeadFieldVisible(stored: unknown, fieldKey: string): boolean {
  if (ALWAYS_ON_FIELDS.has(fieldKey)) return true
  const config = sanitizeLeadFieldConfig(stored)
  if (config.hiddenFields.includes(fieldKey)) return false

  const group = LEAD_FIELD_GROUPS.find((g) => g.fields.some((f) => f.key === fieldKey))
  return !group || !config.hiddenGroups.includes(group.id)
}

/**
 * The catalogue with each group and field marked visible or not — what both
 * panels actually render from.
 */
export function resolveLeadFields(stored: unknown) {
  const config = sanitizeLeadFieldConfig(stored)
  const hiddenGroups = new Set(config.hiddenGroups)
  const hiddenFields = new Set(config.hiddenFields)
  const labels = config.labels ?? {}
  const groupLabels = config.groupLabels ?? {}

  return LEAD_FIELD_GROUPS.map((group) => {
    const groupVisible = !hiddenGroups.has(group.id)
    return {
      id: group.id,
      title: groupLabels[group.id] ?? group.title,
      /** The catalogue wording, so the super admin panel can show what was renamed. */
      defaultTitle: group.title,
      locked: group.locked ?? false,
      visible: groupVisible,
      fields: group.fields.map((f) => ({
        ...f,
        label: labels[f.key] ?? f.label,
        defaultLabel: f.label,
        locked: ALWAYS_ON_FIELDS.has(f.key),
        // A field inside a hidden group is hidden regardless of its own flag.
        visible: groupVisible && !hiddenFields.has(f.key),
      })),
    }
  })
}
