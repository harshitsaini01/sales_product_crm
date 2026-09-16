import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { queryClient } from '@/lib/queryClient'

export type Role = 'admin' | 'sub-admin' | 'sales-head' | 'counsellor' | 'franchise' | 'employee' | 'agent' | 'warehouse' | 'accounts'

interface AuthUser {
  id: number
  loginid: string
  name: string
  email: string
  role: Role
  roles: Role[]
  branchId: number | null
  showFullPhone?: number
  showBucket?: boolean
}

/** The customer this session belongs to. Null for a super admin session. */
export interface AuthTenant {
  id: number
  slug: string
  name: string
  planName: string
  planExpiresAt: string | null
  isPrimary?: boolean
  /** Which preset built this customer: 'education' | 'b2b_sales'. */
  vertical?: string
}

/**
 * Which Lead Information fields this customer has switched off.
 *
 * Only the deviations from "show everything" are stored, so an empty config
 * means the full form — which is what every existing customer gets.
 */
export interface LeadFieldConfig {
  hiddenGroups: string[]
  hiddenFields: string[]
  /**
   * Every hidden field key with groups already flattened in, computed by the
   * server. Prefer this over `hiddenFields`: it means a caller never has to
   * know which group a field belongs to, and cannot silently render one that
   * was switched off by its group.
   */
  hiddenFieldKeys?: string[]
  /** Per-customer field renames: { intrestedCourse: 'Product / Service' }. */
  labels?: Record<string, string>
  /** Per-customer group-heading renames: { other: 'Deal Details' }. */
  groupLabels?: Record<string, string>
}

/**
 * What this customer calls each noun the UI says.
 *
 * Always a COMPLETE map from the server — unlike leadFields, which sends only
 * the deviations, because the client has no catalogue of its own to fall back
 * to here. Empty only before the first /auth/me lands.
 */
export type TermMap = Record<string, { singular: string; plural: string }>

/** A super admin — an account above every customer, not inside one. */
export interface PlatformUser {
  id: number
  name: string
  email: string
  isRoot: boolean
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  isAuthenticated: boolean
  isImpersonating: boolean
  adminToken: string | null
  adminUser: AuthUser | null
  lastActivityTime: number | null

  // ── Multi-tenancy
  /** 'tenant' = inside a customer's CRM, 'platform' = the super admin panel. */
  scope: 'tenant' | 'platform'
  tenant: AuthTenant | null
  platformUser: PlatformUser | null
  /** Modules this customer's plan includes: { whatsapp: true, ... } */
  features: Record<string, boolean>
  /** Lead Information fields this customer has switched off. */
  leadFields: LeadFieldConfig
  /** What this customer calls each noun. See useLabels(). */
  labels: TermMap
  /** Set while a super admin is signed in as this customer. */
  impersonatedBy: { id: number; name: string } | null

  setAuth: (token: string, user: AuthUser, extra?: { tenant?: AuthTenant | null; features?: Record<string, boolean>; labels?: TermMap; leadFields?: LeadFieldConfig }) => void
  setPlatformAuth: (token: string, user: PlatformUser) => void
  /** A super admin stepping into a customer's panel. Keeps the platform session. */
  impersonateTenant: (token: string, user: AuthUser, tenant: AuthTenant, by: { id: number; name: string }) => void
  /** Step back out to the super admin panel. */
  stopTenantImpersonation: () => void
  setTenantMeta: (meta: { tenant?: AuthTenant | null; features?: Record<string, boolean>; leadFields?: LeadFieldConfig | null; labels?: TermMap | null; impersonatedBy?: { id: number; name: string } | null }) => void
  hasFeature: (key: string) => boolean
  /** Should this Lead Information group be rendered? */
  isLeadGroupVisible: (groupId: string) => boolean
  /** Should this Lead Information field be rendered? */
  isLeadFieldVisible: (groupId: string, fieldKey: string) => boolean
  isPlatform: () => boolean
  logout: () => void
  touchActivity: () => void
  impersonate: (token: string, user: AuthUser) => void
  stopImpersonating: () => void
  isAdmin: () => boolean
  isFullAdmin: () => boolean
  canRevealPhone: () => boolean
  isCounsellor: () => boolean
  isFranchise: () => boolean
  isSalesHead: () => boolean
  hasRole: (...roles: Role[]) => boolean
}

/**
 * Modules nobody gets unless their plan turns them on — mirrors
 * `defaultEnabled: false` in the backend's config/features.ts.
 *
 * Only consulted for a key that is absent from the stored map, which happens to
 * every customer whose cached `/auth/me` predates the module. Without this the
 * absent key read as "on" and a Tutelage lead page showed the B2B buttons —
 * Convert to account, the Company tab — all of which 403 on click.
 */
/**
 * Everything in the store that belongs to ONE customer and must not survive a
 * move to another.
 *
 * `leadFields` and `labels` are persisted, so before this existed they outlived
 * every logout and every "Log in as": a super admin stepping from Tutelage into
 * Britannica kept Tutelage's hidden-field list and wording, and because
 * useLeadFields() treats an absent key as "visible, use the fallback label", the
 * B2B lead form and cards rendered the full education schema — Father Name,
 * Mother Name, NEET, "Interested Course".
 *
 * Cleared rather than defaulted: an empty config shows everything for the
 * fraction of a second before /auth/me lands, which is the right way to be
 * wrong. Showing the PREVIOUS customer's is not.
 */
/**
 * Throw away every cached server response belonging to the session we are
 * leaving.
 *
 * The store alone was not enough. AppLayout reads /auth/me through TanStack
 * Query with a 60s staleTime, so "Log in as" moved the token but the cache
 * happily served the PREVIOUS customer's /auth/me — which setTenantMeta then
 * wrote straight back into the store, undoing the reset below. Everything else
 * cached under the old token (lead lists, dashboard counts) belonged to that
 * customer too and must not be rendered under this one.
 *
 * Done here rather than at the seven call sites of logout(), so a new one
 * cannot forget.
 */
function dropCachedServerState() {
  queryClient.clear()
}

function blankTenantMeta() {
  return {
    tenant: null,
    features: {} as Record<string, boolean>,
    leadFields: { hiddenGroups: [] as string[], hiddenFields: [] as string[] },
    labels: {} as TermMap,
    impersonatedBy: null,
  }
}

const DEFAULT_OFF = new Set([
  'campaigns', 'inbox', 'whatsapp', 'auto_dialer', 'university_apps', 'mobile_app',
  'call_recording', 'location_tracking', 'accounts', 'deals', 'sales_docs',
  'custom_fields', 'lead_staging', 'bulk_ops', 'lead_work', 'public_api',
])

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      isImpersonating: false,
      adminToken: null,
      adminUser: null,
      lastActivityTime: null,
      scope: 'tenant',
      tenant: null,
      platformUser: null,
      features: {},
      leadFields: { hiddenGroups: [], hiddenFields: [] },
      labels: {},
      impersonatedBy: null,

      setAuth: (token, user, extra) => {
        dropCachedServerState()
        set({
          ...blankTenantMeta(),
          token,
          user,
          isAuthenticated: true,
          lastActivityTime: Date.now(),
          scope: 'tenant',
          platformUser: null,
          tenant: extra?.tenant ?? null,
          features: extra?.features ?? {},
          labels: extra?.labels ?? {},
          // The login response carries leadFields, so apply it immediately.
          // Leaving it blank until /auth/me landed meant every lead field
          // rendered in the meantime — and stayed rendered if that call ever
          // failed. blankTenantMeta() still clears it first, so a stale config
          // from the previous customer can never survive a login.
          ...(extra?.leadFields ? { leadFields: extra.leadFields } : {}),
        })
      },

      setPlatformAuth: (token, platformUser) => {
        dropCachedServerState()
        set({
          ...blankTenantMeta(),
          token,
          platformUser,
          user: null,
          isAuthenticated: true,
          lastActivityTime: Date.now(),
          scope: 'platform',
        })
      },

      // A super admin "logging in as" a customer. Distinct from the ordinary
      // impersonate() below, which is an admin acting as one of their OWN staff:
      // here the session we are suspending is a PLATFORM session, so it has to
      // be stashed separately — adminUser is null in platform scope, and the
      // generic stopImpersonating() would read that as "nothing to go back to"
      // and sign the super admin out completely.
      impersonateTenant: (token, user, tenant, by) => {
        const { token: platformToken, platformUser } = get()
        dropCachedServerState()
        set({
          // Drop the previous customer's modules, fields and wording FIRST, so
          // nothing of theirs is on screen while /auth/me fetches this one's.
          ...blankTenantMeta(),
          token,
          user,
          tenant,
          isAuthenticated: true,
          scope: 'tenant',
          isImpersonating: true,
          impersonatedBy: by,
          // Stashed so stopTenantImpersonation() can put us straight back.
          adminToken: platformToken,
          platformUser,
          lastActivityTime: Date.now(),
        })
      },

      stopTenantImpersonation: () => {
        const { adminToken, platformUser } = get()
        dropCachedServerState()
        if (!adminToken || !platformUser) {
          // No platform session to return to — safest is a clean sign-out.
          get().logout()
          return
        }
        set({
          ...blankTenantMeta(),
          token: adminToken,
          platformUser,
          user: null,
          scope: 'platform',
          isAuthenticated: true,
          isImpersonating: false,
          impersonatedBy: null,
          adminToken: null,
          adminUser: null,
          lastActivityTime: Date.now(),
        })
      },

      // Called after /auth/me, which is the authoritative source for the
      // customer's current plan and modules — a super admin can change either
      // of them while the user is signed in.
      setTenantMeta: (meta) =>
        set((s) => ({
          tenant: meta.tenant !== undefined ? meta.tenant : s.tenant,
          features: meta.features !== undefined ? meta.features : s.features,
          leadFields: meta.leadFields ?? s.leadFields,
          labels: meta.labels ?? s.labels,
          impersonatedBy: meta.impersonatedBy !== undefined ? meta.impersonatedBy : s.impersonatedBy,
        })),

      hasFeature: (key) => {
        const { features, scope } = get()
        if (scope === 'platform') return true
        const stored = features[key]
        if (typeof stored === 'boolean') return stored
        // Key we have never seen. `features` is persisted, so this is a map
        // written before the module was added to the catalogue — not merely a
        // slow first paint. Guess in the direction that is wrong the least:
        // allow an on-by-default module rather than flash the nav empty, but
        // never an off-by-default one, which no customer has until their plan
        // says so. The API is the real gate either way.
        return !DEFAULT_OFF.has(key)
      },

      // Default to visible. Before /auth/me lands the config is empty, and a
      // blank Lead Information tab on first paint would be far worse than
      // briefly showing a field the customer has switched off.
      isLeadGroupVisible: (groupId) => !get().leadFields?.hiddenGroups?.includes(groupId),

      isLeadFieldVisible: (groupId, fieldKey) => {
        const cfg = get().leadFields
        if (!cfg) return true
        if (cfg.hiddenGroups?.includes(groupId)) return false
        return !cfg.hiddenFields?.includes(fieldKey)
      },

      isPlatform: () => get().scope === 'platform',

      logout: () => {
        dropCachedServerState()
        set({
          ...blankTenantMeta(),
          token: null,
          user: null,
          isAuthenticated: false,
          isImpersonating: false,
          adminToken: null,
          adminUser: null,
          lastActivityTime: null,
          scope: 'tenant',
          platformUser: null,
        })
      },

      touchActivity: () => set({ lastActivityTime: Date.now() }),

      impersonate: (token, user) => {
        const { token: currentToken, user: currentUser, adminToken, adminUser } = get()
        // Same customer, so the field config and wording stand. What must go is
        // the cached data: a counsellor sees only their own assigned leads, and
        // the admin's list is still sitting in the query cache.
        dropCachedServerState()
        set({
          token,
          user,
          isAuthenticated: true,
          isImpersonating: true,
          adminToken: adminToken || currentToken,
          adminUser: adminUser || currentUser,
          lastActivityTime: Date.now(),
        })
      },

      stopImpersonating: () => {
        const { adminToken, adminUser } = get()
        dropCachedServerState()
        if (adminToken && adminUser) {
          set({
            token: adminToken,
            user: adminUser,
            isAuthenticated: true,
            isImpersonating: false,
            adminToken: null,
            adminUser: null,
            lastActivityTime: Date.now(),
          })
        } else {
          set({
            token: null,
            user: null,
            isAuthenticated: false,
            isImpersonating: false,
            adminToken: null,
            adminUser: null,
            lastActivityTime: null,
          })
        }
      },

      isAdmin: () => {
        const { user } = get()
        return !!(user?.roles?.includes('admin') || user?.roles?.includes('sub-admin'))
      },

      // ONLY the top-level admin. Drives things sub-admin must NOT have: full
      // phone numbers, lead export, and the Team Members / Workflows nav.
      isFullAdmin: () => {
        const { user } = get()
        return !!user?.roles?.includes('admin')
      },

      canRevealPhone: () => {
        const { user } = get()
        if (!user) return false
        return !!(user.roles?.includes('admin') || user.showFullPhone === 1)
      },

      isCounsellor: () => {
        const { user } = get()
        return !!user?.roles?.includes('counsellor')
      },

      isFranchise: () => {
        const { user } = get()
        return !!user?.roles?.includes('franchise')
      },

      isSalesHead: () => {
        const { user } = get()
        return !!user?.roles?.includes('sales-head')
      },

      hasRole: (...roles: Role[]) => {
        const { user } = get()
        return !!(user?.roles?.some((r) => roles.includes(r)))
      },
    }),
    {
      name: 'crm-auth',
      partialize: (s) => ({
        token: s.token,
        user: s.user,
        isAuthenticated: s.isAuthenticated,
        isImpersonating: s.isImpersonating,
        adminToken: s.adminToken,
        adminUser: s.adminUser,
        lastActivityTime: s.lastActivityTime,
        scope: s.scope,
        tenant: s.tenant,
        platformUser: s.platformUser,
        features: s.features,
        leadFields: s.leadFields,
        labels: s.labels,
        impersonatedBy: s.impersonatedBy,
      }),
    }
  )
)
