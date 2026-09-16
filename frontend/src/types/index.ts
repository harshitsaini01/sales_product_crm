// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: number
  name: string
  email: string
  role: string
  roles: string[]
  branchId: number | null
  designation?: string
  mobile?: string
  showFullPhone?: number
}

export interface CounsellorRemark {
  id: number
  counsellorId: number
  createdById: number
  remark: string
  callId?: number | null
  hourContext?: string | null
  createdAt: string
  updatedAt: string
  createdBy?: {
    id: number
    name: string
    role: string
    email?: string
  } | null
  counsellor?: {
    id: number
    name: string
    role: string
    email?: string
  } | null
  call?: {
    id: number
    phoneNumber: string
    direction: 'OUTGOING' | 'INCOMING'
    status: string
    startedAt: string
    durationSec: number
    lead?: {
      id: number
      name: string
      mobile?: string | null
    } | null
  } | null
}




// ─── User ─────────────────────────────────────────────────────────────────────

export interface User {
  id: number
  name: string
  email: string
  mobile: string
  loginid: string
  username: string
  role: string
  roles?: string[]
  passwordCopy?: string
  status: number
  branchId: number | null
  designation?: string
  gender?: string
  dob?: string
  joiningDate?: string
  salary?: number
  address?: string
  city?: string
  state?: string
  country?: string
  nickName?: string
  automaticAsignLead?: number
  showFullPhone?: number
  createdBy?: number
  newApplicant?: number
  createdAt: string
  updatedAt: string
  branch?: Branch
}

// ─── Lead ─────────────────────────────────────────────────────────────────────

export interface Lead {
  id: number
  /**
   * The company this lead belongs to, for customers that have companies.
   * Absent entirely on the education install — its list query does not ask
   * for it. `accountId` is set only once the lead has actually been converted.
   */
  business?: {
    companyName: string | null
    accountId: number | null
    projectTitle: string | null
  } | null
  // Personal
  name: string
  father?: string
  mother?: string
  fatherMobile?: string
  motherMobile?: string
  dob?: string
  gender?: string
  castCategory?: string
  nationality?: string
  religion?: string
  passportNumber?: string
  firstLanguage?: string
  maritalStatus?: string
  passportExpiry?: string
  imgpath?: string
  imgname?: string
  // Contact
  email?: string
  email2?: string
  email3?: string
  mobile?: string
  mobile2?: string
  mobile3?: string
  password?: string
  // Server-computed duplicate flags (per-field, calculated at list-time)
  emailDup?: boolean
  mobileDup?: boolean
  // Address
  city?: string
  state?: string
  country?: string
  pincode?: string
  homeAddress?: string
  homeContactNumber?: string
  // Academic
  intrestedCourse?: string
  intrestedSubject?: string
  intrestedUniversity?: string
  approximateBudget?: string
  highestQualification?: string
  preferredDestination?: string
  persuingCountry?: string
  englishExamType?: string
  overallScore?: number
  neetscore?: string
  neetRank?: string
  neetQualified?: string
  neetPassingYear?: number
  countryOfEducation?: string
  highestLevelOfEducation?: string
  gradingScheme?: string
  gradeAverage?: string
  studentType?: string
  neetResult?: string
  dateOfExam?: string
  listeningScore?: string
  readingScore?: string
  writingScore?: string
  speakingScore?: string
  hs?: string
  hsSchoolName?: string
  hsPassingYear?: string
  hsResult?: string
  intr?: string
  intrSchoolName?: string
  intrPassingYear?: string
  intrResult?: string
  ug?: string
  ugSchoolName?: string
  ugPassingYear?: string
  ugResult?: string
  ucat?: number
  ucatExamDate?: string
  ucatVScore?: string
  ucatVRank?: string
  ucatQScore?: string
  ucatQRank?: string
  ucatWScore?: string
  ucatWRank?: string
  dmat?: number
  dmatExamDate?: string
  dmatVScore?: string
  dmatVRank?: string
  dmatQScore?: string
  dmatQRank?: string
  dmatWScore?: string
  dmatWRank?: string
  dmatIrScore?: string
  dmatIrRank?: string
  dmatTotalScore?: string
  dmatTotalRank?: string
  sat?: number
  satExamDate?: string
  satReasoningPoints?: string
  satSubjectPoints?: string
  // Lead tracking
  leadType: string
  leadStatus: string
  leadSubStatus?: string
  leadStatusId?: number
  leadSubStatusId?: number
  leadFollowStatus?: number
  departmentId?: number
  statusLeadTypeId?: number
  userId: number
  event?: string
  source?: string
  sourceUrl?: string
  website: string
  comment?: string
  // Engagement
  called: number
  wapp: number
  callAnsweredStatus?: string
  flagSend: number
  flagRcv: number
  // Dates
  followupDate?: string
  commentDate?: string
  reminderDate?: string
  // Financial
  enrolled?: number
  course?: string
  totalFees?: number
  totalDepositFees?: number
  balanceFees?: number
  // System
  asign: number
  trash: number
  status?: number
  isDuplicate?: boolean
  duplicateOfId?: number | null
  createdAt: string
  updatedAt: string
  // Relations
  assignedTo?: AssignedLead[]
  followups?: LeadFollowup[]
  notes?: LeadNote[]
  documents?: StudentDocument[]
  reminders?: Reminder[]
}

// ─── Lead Assignment ──────────────────────────────────────────────────────────

export interface AssignedLead {
  id: number
  clrId: number
  stdId: number
  leadType: string
  leadStatusId?: number
  leadSubStatusId?: number
  leadFollowUpStatusId?: number
  callAnsweredStatus?: number
  departmentId?: number
  statusLeadTypeId?: number
  called: number
  wapp: number
  status: number
  createdAt: string
  updatedAt: string
  counsellor?: Pick<User, 'id' | 'name' | 'email'>
}

// ─── Lead Follow-up ──────────────────────────────────────────────────────────

export interface LeadFollowup {
  id: number
  leadStatusId?: number
  leadSubStatusId?: number
  userid: number
  stdId: number
  comment: string
  status: number
  type?: string
  fStatus?: string
  description?: string
  followupDate?: string
  callAnsweredStatus?: number
  departmentId?: number
  statusLeadTypeId?: number
  createdAt: string
  updatedAt: string
  user?: Pick<User, 'id' | 'name'>
}

// ─── Lead Note ────────────────────────────────────────────────────────────────

export interface LeadNote {
  id: number
  leadId: number
  userId: number
  note: string
  createdAt: string
  updatedAt: string
  user?: Pick<User, 'id' | 'name'>
}

// ─── Lead Config ─────────────────────────────────────────────────────────────

export interface LeadStatus {
  id: number
  title: string
  slug: string
  departmentId: number
  moveTo?: string
  priority: number
  subStatuses?: LeadSubStatus[]
}

export interface LeadSubStatus {
  id: number
  statusId: number
  subStatus: string
  subStatusSlug: string
  moveTo?: number
  departmentId?: number
  statusLeadTypeId?: number
}

export interface LeadFollowupStatus {
  id: number
  status: string
  shortnote?: string
}

export interface LeadDepartment {
  id: number
  name: string
  slug: string
  priority: number
  status: number
}

export interface LeadTypeConfig {
  id: number
  title: string
  slug: string
  departmentId?: number
  priority: number
}

// ─── Branch ──────────────────────────────────────────────────────────────────

export interface Branch {
  id: number
  name: string
  city?: string
  state?: string
  country?: string
  status: number
}

// ─── Student / Financial ──────────────────────────────────────────────────────

export interface StudentDocument {
  id: number
  leadId: number
  title: string
  filepath: string
  filename: string
  createdAt: string
}

export interface Reminder {
  id: number
  leadId: number
  userId: number
  reminderDate: string
  note?: string
  status: number
  createdAt: string
  user?: Pick<User, 'id' | 'name'>
  lead?: Pick<Lead, 'id' | 'name' | 'mobile'>
}

export interface Invoice {
  id: number
  leadId: number
  userId: number
  invoiceNo: string
  amount: string
  dueDate?: string
  status: string
  description?: string
  createdAt: string
  payments?: FeePayment[]
}

export interface FeePayment {
  id: number
  invoiceId: number
  leadId: number
  amount: string
  paidAt: string
  mode?: string
  note?: string
  createdAt: string
}

// ─── Task ─────────────────────────────────────────────────────────────────────

export interface Task {
  id: number
  title: string
  description?: string
  assignedById: number
  assignedToId: number
  dueDate?: string
  status: number
  priority: string
  createdAt: string
  assignedBy?: Pick<User, 'id' | 'name'>
  assignedTo?: Pick<User, 'id' | 'name'>
}

// ─── Communication ────────────────────────────────────────────────────────────

export interface MailTemplate {
  id: number
  title: string
  subject: string
  body: string
  userId: number
  status: number
}

export interface Signature {
  id: number
  title: string
  content: string
  userId: number
  isDefault: number
}

export interface EmailHeader {
  id: number
  name: string
  email: string
  userId: number
  isDefault: number
  status: number
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface DashboardStats {
  totalLeads: number
  todayLeads: number
  weekLeads: number
  monthLeads: number
  todayFollowups: number
  enrolledCount: number
  overdueFollowups: number
  activeLeads: number
  newApplicants?: number
  freshLeads?: number
}

// ─── API response util ────────────────────────────────────────────────────────

export interface ApiError {
  error: string
  details?: unknown
}

// ─── Extras ────────────────────────────────────────────────────────
export interface Agent {
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
  createdAt: string
  updatedAt: string
}

export interface SystemSetting {
  id: number
  key: string
  value: string
}

