// ─────────────────────────────────────────────────────────────────────────────
// The catalogue of modules a super admin can switch on or off per customer.
//
// Adding a feature here is all it takes for it to appear in the super admin
// panel's toggle grid — the tenant's stored `features` JSON only records
// deviations from `defaultEnabled`, so no migration is needed.
//
// `apiPrefixes` are the /api mounts guarded by requireFeature() in
// routes/index.ts.
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureDef {
  key: string
  label: string
  group: 'Core' | 'Lead Pipeline' | 'Outreach' | 'Team' | 'Mobile' | 'B2B' | 'Advanced'
  description: string
  /** Off by default for new customers unless the plan turns it on. */
  defaultEnabled: boolean
  /**
   * Switchable like everything else, but load-bearing: other modules are built
   * on top of it, and turning it off degrades far more than its own screens.
   *
   * This is a WARNING, not a lock — the super admin panel asks for confirmation
   * before switching one off and says what will break. The app stays usable
   * either way: the router falls back to the first module the customer actually
   * has rather than assuming the dashboard exists.
   */
  critical?: boolean
  /** What actually breaks. Shown at the point of switching it off. */
  criticalWarning?: string
  /** Route mounts (relative to /api) guarded by this feature. */
  apiPrefixes: string[]
}

export const FEATURES: FeatureDef[] = [
  // ── The load-bearing modules. Switchable like everything else, but flagged
  //    `critical` so the panel warns before one is turned off. See FeatureDef.
  {
    key: 'leads',
    label: 'Leads',
    group: 'Core',
    description: 'The lead record itself, plus its notes, comments and follow-ups.',
    defaultEnabled: true,
    critical: true,
    criticalWarning:
      'Students, tasks, calls, campaigns and the B2B modules all hang off a lead. ' +
      'Switch this off only for a customer who works no leads at all.',
    apiPrefixes: ['/leads', '/notes', '/comments', '/followups', '/verified'],
  },
  {
    key: 'users',
    label: 'Team Members',
    group: 'Core',
    description: 'Staff accounts, roles and lead assignment.',
    defaultEnabled: true,
    critical: true,
    criticalWarning:
      'Their admin will no longer be able to add, edit or deactivate staff — ' +
      'you would have to do it for them from here.',
    apiPrefixes: ['/users'],
  },
  {
    key: 'dashboard',
    label: 'Dashboard',
    group: 'Core',
    description: 'The landing screen and its summary counts.',
    defaultEnabled: true,
    critical: true,
    criticalWarning:
      'Sign-in will land on the first module they do have instead. Safe, but ' +
      'they lose the summary counts.',
    apiPrefixes: ['/dashboard'],
  },
  {
    key: 'settings',
    label: 'System Settings',
    group: 'Core',
    description: 'Company details, the notification bell and app-wide preferences.',
    defaultEnabled: true,
    critical: true,
    criticalWarning:
      'Company details and the notification bell go with it. Nothing crashes, ' +
      'but their admin loses the settings screen.',
    apiPrefixes: ['/settings', '/notifications'],
  },

  // ── Lead pipeline.
  //
  //    EVERY ONE OF THESE DEFAULTS TO TRUE, and that is not a style choice. A
  //    customer stores only their deviations from the catalogue, so a key they
  //    have never seen falls back to `defaultEnabled`. Adding one that defaults
  //    to false would silently strip the module from every customer already
  //    live. New flags for existing behaviour must always default on.
  {
    key: 'bucket',
    label: 'Bucket',
    group: 'Lead Pipeline',
    description: 'The unworked-lead queue a counsellor pulls their next call from.',
    defaultEnabled: true,
    apiPrefixes: [],
  },
  {
    key: 'lead_config',
    label: 'Lead Workflow',
    group: 'Lead Pipeline',
    description: 'Editing departments, statuses, sub-statuses and lead types.',
    defaultEnabled: true,
    apiPrefixes: ['/lead-config'],
  },
  {
    key: 'lead_sources',
    label: 'Lead Sources',
    group: 'Lead Pipeline',
    description: 'Per-source API keys and webhook endpoints for inbound leads.',
    defaultEnabled: true,
    apiPrefixes: ['/lead-sources'],
  },
  {
    key: 'duplicates',
    label: 'Duplicates',
    group: 'Lead Pipeline',
    description: 'The duplicate-lead review screen.',
    defaultEnabled: true,
    apiPrefixes: [],
  },
  {
    key: 'trash',
    label: 'Trash',
    group: 'Lead Pipeline',
    description: 'Soft-deleted leads, and restoring them.',
    defaultEnabled: true,
    apiPrefixes: [],
  },
  {
    key: 'remarks',
    label: 'Remarks',
    group: 'Lead Pipeline',
    description: 'Free-text counsellor remarks on a lead, and the remarks report.',
    defaultEnabled: true,
    apiPrefixes: ['/remarks'],
  },
  {
    key: 'reminders',
    label: 'Reminders',
    group: 'Lead Pipeline',
    description: 'Personal reminders against a lead.',
    defaultEnabled: true,
    apiPrefixes: ['/reminders'],
  },
  {
    key: 'calendar',
    label: 'Calendar & Events',
    group: 'Lead Pipeline',
    description: 'The follow-up calendar and team events.',
    defaultEnabled: true,
    apiPrefixes: ['/events'],
  },
  {
    key: 'reports',
    label: 'Reports',
    group: 'Lead Pipeline',
    description: 'Conversion, counsellor and source reports.',
    defaultEnabled: true,
    apiPrefixes: ['/reports'],
  },
  {
    key: 'daily_reports',
    label: 'Daily Reports',
    group: 'Lead Pipeline',
    description: 'What each staff member did today, self-reported and measured.',
    defaultEnabled: true,
    apiPrefixes: ['/daily-reports'],
  },

  // ── Team
  {
    key: 'activity_tracking',
    label: 'Activity & Inactivity Monitor',
    group: 'Team',
    description: 'Per-user activity trail and the idle-staff warnings built on it.',
    defaultEnabled: true,
    apiPrefixes: ['/activity'],
  },
  {
    key: 'login_logs',
    label: 'Login Logs',
    group: 'Team',
    description: 'Who signed in, from where, on web and mobile.',
    defaultEnabled: true,
    apiPrefixes: [],
  },
  {
    key: 'announcements',
    label: 'Announcements',
    group: 'Team',
    description: 'Broadcast notices to staff, with read receipts.',
    defaultEnabled: true,
    apiPrefixes: ['/announcements'],
  },
  {
    key: 'chat',
    label: 'Internal Chat',
    group: 'Team',
    description: 'Direct messages between staff.',
    defaultEnabled: true,
    apiPrefixes: ['/chat'],
  },
  {
    key: 'agents',
    label: 'Partner Agents',
    group: 'Team',
    description: 'Outside parties who refer leads.',
    defaultEnabled: true,
    apiPrefixes: ['/agents'],
  },

  {
    key: 'students',
    label: 'Students',
    group: 'Core',
    description: 'Admissions enrollments. Off in this product-sales CRM.',
    defaultEnabled: false,
    apiPrefixes: ['/students'],
  },
  {
    key: 'financial',
    label: 'Invoices & Payments',
    group: 'Core',
    description: 'Legacy fee invoices. GST invoices live under Sales Docs.',
    defaultEnabled: true,
    apiPrefixes: ['/financial'],
  },
  {
    key: 'branches',
    label: 'Branches',
    group: 'Core',
    description: 'Multiple office branches with branch-scoped sub-admins.',
    defaultEnabled: true,
    apiPrefixes: ['/branches'],
  },
  {
    key: 'tasks',
    label: 'Tasks & Leaves',
    group: 'Core',
    description: 'Task assignment, task boards and the staff leave register.',
    defaultEnabled: true,
    apiPrefixes: ['/tasks', '/leaves'],
  },

  // ── Outreach
  {
    key: 'email',
    label: 'Email & Templates',
    group: 'Outreach',
    description: 'Mail templates, signatures, headers and sending mail against a lead.',
    defaultEnabled: true,
    apiPrefixes: ['/communication'],
  },
  {
    key: 'campaigns',
    label: 'Bulk Email Campaigns',
    group: 'Outreach',
    description: 'Segmented bulk email with open tracking, chunked sending and per-recipient status.',
    defaultEnabled: false,
    apiPrefixes: ['/campaigns'],
  },
  {
    key: 'inbox',
    label: 'Shared Inbox (IMAP)',
    group: 'Outreach',
    description: 'Poll connected mailboxes and thread replies against leads.',
    defaultEnabled: false,
    apiPrefixes: ['/inbox', '/webmail-accounts'],
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp Templates',
    group: 'Outreach',
    description: 'Reusable WhatsApp message templates with attachments.',
    defaultEnabled: false,
    apiPrefixes: ['/whatsapp-templates'],
  },
  {
    key: 'auto_dialer',
    label: 'Auto Dialer',
    group: 'Outreach',
    description: 'Outbound calling campaigns with recordings and per-agent assignment.',
    defaultEnabled: false,
    apiPrefixes: ['/auto-dialer'],
  },
  {
    key: 'b2b',
    label: 'B2B Contacts',
    group: 'Outreach',
    description: 'A separate business-contact book, kept apart from leads.',
    defaultEnabled: false,
    apiPrefixes: ['/b2b'],
  },
  {
    key: 'university_apps',
    label: 'University Applications',
    group: 'Outreach',
    description: 'Track applications to universities and the mail threads attached to them.',
    defaultEnabled: false,
    apiPrefixes: ['/university-applications'],
  },

  // ── Mobile
  {
    key: 'mobile_app',
    label: 'Sales Mobile App',
    group: 'Mobile',
    description: 'Android app sign-in, push notifications and app release downloads.',
    defaultEnabled: false,
    apiPrefixes: ['/mobile', '/app-releases'],
  },
  {
    key: 'call_recording',
    label: 'Call Logs & Recordings',
    group: 'Mobile',
    description: 'Sync call logs from the mobile app and store call recordings.',
    defaultEnabled: false,
    apiPrefixes: ['/calls'],
  },
  {
    key: 'location_tracking',
    label: 'Live Location Tracking',
    group: 'Mobile',
    description: 'Field-staff location trail and the live location map.',
    defaultEnabled: false,
    apiPrefixes: ['/locations'],
  },

  // ── B2B sales core. New tables (crm_*), off for everyone by default, so an
  //    education customer gets the tables created empty and never sees a nav
  //    item, a route or an API mount for any of it.
  {
    key: 'accounts',
    label: 'Accounts & Contacts',
    group: 'B2B',
    description:
      'Organisations, their locations and the people inside them, with a shared activity timeline. The B2B core.',
    defaultEnabled: false,
    apiPrefixes: ['/accounts', '/contacts', '/crm', '/lead-business'],
  },
  {
    key: 'deals',
    label: 'Deals & Pipeline',
    group: 'B2B',
    description:
      'Configurable sales pipelines, opportunities on a drag-and-drop board, a product catalogue and deal line items.',
    defaultEnabled: false,
    apiPrefixes: ['/deals', '/products', '/pipelines'],
  },
  {
    key: 'sales_docs',
    label: 'Quotes, Orders & Invoices',
    group: 'B2B',
    description:
      'The document chain after a deal: quotes, contracts, orders, B2B tax invoices and payments, with an ageing report.',
    defaultEnabled: false,
    apiPrefixes: ['/quotes', '/contracts', '/orders', '/invoices', '/sales-chain', '/commerce'],
  },
  {
    key: 'projects',
    label: 'Projects & Proposals',
    group: 'B2B',
    description:
      'A brief becomes a project: assign it to a department (IT, Digital Marketing…), work the proposal ' +
      'in an internal thread, then send it to the client by email and see their replies on the same thread.',
    defaultEnabled: false,
    apiPrefixes: ['/projects', '/teams'],
  },
  {
    key: 'custom_fields',
    // Deliberately not in the B2B group. This is how ANY customer records what
    // is particular to them — NEET rank for an admissions consultancy, seat
    // count for an IT reseller, SKU and margin for a product seller. It is the
    // mechanism that lets a new vertical exist at all, not a B2B extra.
    group: 'Advanced',
    label: 'Custom Fields',
    description:
      'Fields your team defines, on leads, companies, contacts and deals — stored as data, so adding one never touches anybody else’s database.',
    defaultEnabled: false,
    apiPrefixes: ['/custom-fields'],
  },

  // ── Advanced
  {
    key: 'lead_staging',
    label: 'Lead Staging & Review',
    group: 'Advanced',
    description: 'Stage imported leads in batches for review before they enter the pipeline.',
    defaultEnabled: false,
    apiPrefixes: ['/lead-staging'],
  },
  {
    key: 'bulk_ops',
    label: 'Bulk Operations',
    group: 'Advanced',
    description: 'Mass reassign, update and delete leads, with an undo history.',
    defaultEnabled: false,
    apiPrefixes: ['/bulk'],
  },
  {
    key: 'lead_work',
    label: 'Lead Workboard',
    group: 'Advanced',
    description: 'Daily calling batches built from filters and handed to counsellors.',
    defaultEnabled: false,
    apiPrefixes: ['/lead-work'],
  },
  {
    key: 'public_api',
    label: 'Public Lead API',
    group: 'Advanced',
    description: 'Accept leads from websites and partners over the /v1 ingestion endpoints.',
    defaultEnabled: false,
    apiPrefixes: [],
  },
]

// NOTE: there is deliberately no 'api_metrics' entry. API usage used to be a
// per-customer module, but endpoint latency and error rates are facts about the
// platform, not about any one customer — and the accumulator is a single
// process-wide buffer. It now lives in the super admin panel only, at
// /api/platform/metrics.

export const FEATURE_KEYS = FEATURES.map((f) => f.key)

const BY_KEY = new Map(FEATURES.map((f) => [f.key, f]))

export function getFeature(key: string): FeatureDef | undefined {
  return BY_KEY.get(key)
}

/** Everything a brand-new customer gets unless the wizard says otherwise. */
export function defaultFeatureMap(): Record<string, boolean> {
  return Object.fromEntries(FEATURES.map((f) => [f.key, f.defaultEnabled]))
}

/**
 * The original install predates feature flags and must keep every module it
 * already had, so it gets the full set regardless of `defaultEnabled`.
 */
export function allFeaturesOn(): Record<string, boolean> {
  return Object.fromEntries(FEATURES.map((f) => [f.key, true]))
}

/**
 * Resolve a tenant's stored (possibly partial) map into a complete one. An
 * unknown key in the stored JSON is ignored; a missing one falls back to the
 * catalogue default.
 */
export function resolveFeatures(stored: unknown): Record<string, boolean> {
  const raw = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  const out: Record<string, boolean> = {}
  for (const f of FEATURES) {
    out[f.key] = typeof raw[f.key] === 'boolean' ? (raw[f.key] as boolean) : f.defaultEnabled
  }
  return out
}

/** Keep only known keys, so a bad payload cannot stuff junk into the column. */
export function sanitizeFeatureMap(input: unknown): Record<string, boolean> {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const out: Record<string, boolean> = {}
  for (const f of FEATURES) {
    if (typeof raw[f.key] === 'boolean') out[f.key] = raw[f.key] as boolean
  }
  return out
}
