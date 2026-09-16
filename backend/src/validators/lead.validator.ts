import { z } from 'zod';

/**
 * Zod schema for creating a new lead.
 * All fields match the legacy `leads` table exactly.
 */
export const createLeadSchema = z.object({
  // Personal
  name: z.string().min(1, 'Name is required').max(100),
  father: z.string().max(100).optional(),
  mother: z.string().max(100).optional(),
  fatherMobile: z.string().max(20).optional(),
  motherMobile: z.string().max(20).optional(),
  dob: z.string().optional(),
  gender: z.string().max(10).optional(),
  castCategory: z.string().max(100).optional(),
  nationality: z.string().max(50).optional(),
  religion: z.string().max(100).optional(),
  passportNumber: z.string().max(100).optional(),

  // Contact
  email: z.string().email().optional().or(z.literal('')),
  email2: z.string().email().optional().or(z.literal('')),
  email3: z.string().email().optional().or(z.literal('')),
  mobile: z.string().max(50).optional(),
  mobile2: z.string().max(20).optional(),
  mobile3: z.string().max(20).optional(),

  // Address
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  country: z.string().max(100).optional(),
  pincode: z.string().max(20).optional(),

  // Academic
  intrestedCourse: z.string().max(100).optional(),
  intrestedSubject: z.string().max(100).optional(),
  intrestedUniversity: z.string().max(50).optional(),
  approximateBudget: z.string().max(100).optional(),
  highestQualification: z.string().max(100).optional(),
  preferredDestination: z.string().max(100).optional(),
  persuingCountry: z.string().max(100).optional(),
  englishExamType: z.string().max(50).optional(),
  overallScore: z.number().int().optional(),
  neetscore: z.string().max(20).optional(),
  neetRank: z.string().max(100).optional(),
  neetQualified: z.string().max(100).optional(),
  neetPassingYear: z.number().int().optional(),

  // Lead tracking
  leadType: z.string().max(50).default('new'),
  departmentId: z.number().int().optional(),
  event: z.string().max(50).optional(),
  source: z.string().max(100).optional(),
  sourceUrl: z.string().optional(),
  website: z.string().max(100).default('other'),
  comment: z.string().optional(),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;

/**
 * Schema for updating an existing lead.
 * All fields are optional on update.
 */
export const updateLeadSchema = createLeadSchema.partial().extend({
  leadStatus: z.string().max(100).optional(),
  leadSubStatus: z.string().max(100).optional(),
  leadStatusId: z.number().int().optional(),
  leadSubStatusId: z.number().int().optional(),
  leadFollowStatus: z.number().int().optional(),
  statusLeadTypeId: z.number().int().optional(),
  followupDate: z.string().optional(),
  reminderDate: z.string().optional(),
  called: z.number().int().min(0).max(1).optional(),
  wapp: z.number().int().min(0).max(1).optional(),
  callAnsweredStatus: z.string().optional(),
  flagSend: z.number().int().min(0).max(1).optional(),
  flagRcv: z.number().int().min(0).max(1).optional(),
  trash: z.number().int().min(0).max(1).optional(),
  totalDepositFees: z.number().int().optional(),
  balanceFees: z.number().int().optional(),
});

export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

/**
 * Schema for lead list query parameters (filters, pagination).
 */
export const leadQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(25),
  search: z.string().optional(),
  leadType: z.string().optional(),
  departmentId: z.coerce.number().int().optional(),
  leadStatusId: z.coerce.number().int().optional(),
  leadSubStatusId: z.coerce.number().int().optional(),
  event: z.string().optional(),
  website: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  called: z.coerce.number().int().min(0).max(1).optional(),
  wapp: z.coerce.number().int().min(0).max(1).optional(),
  trash: z.coerce.number().int().min(0).max(1).default(0),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  followupDate: z.string().optional(),
  counsellorId: z.coerce.number().int().optional(),
  // When true, every user-selected filter clause is negated (NULL-safely — see
  // negateLeadClause) and ANDed together → "show leads NOT matching any of
  // these selections".
  excludeMode: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
  // Comma-separated filter keys that excludeMode is allowed to invert. Absent
  // ⇒ invert everything. The web Leads page sends it so that Exclude does not
  // also negate the department sub-nav / lead-type tab it rides along with.
  // NOTE: this schema is not currently wired into any route — buildLeadWhere
  // reads the raw query string. It is listed here so that if the schema is ever
  // applied, Zod's default key-stripping does not silently drop the param.
  excludeFields: z.string().optional(),
  sortBy: z.string().default('id'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type LeadQueryInput = z.infer<typeof leadQuerySchema>;
