import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Search, Users } from 'lucide-react'
import { contactsApi, CONTACT_ROLES, RELATIONSHIP_STRENGTHS, type Contact } from '@/lib/crm-api'
import { useLabels } from '@/hooks/useLabels'

/**
 * Contacts across every account.
 *
 * The per-account list lives on the account page; this is the "find me that
 * person whose company I cannot remember" view, which is how sales people
 * actually search when a number rings back.
 */
export default function Contacts() {
  const t = useLabels()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', { search, role, page }],
    queryFn: () =>
      contactsApi.list({ search: search || undefined, role: role || undefined, page, limit: 25 }),
  })

  const contacts = data?.data ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t.plural('contact')}</h1>
        <p className="text-sm text-muted-foreground">
          {data?.total ?? 0} {(data?.total ?? 0) === 1 ? 'person' : 'people'}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm"
            placeholder="Name, email, mobile or job title…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <select
          className="rounded-lg border bg-background px-3 py-2 text-sm"
          value={role}
          onChange={(e) => {
            setRole(e.target.value)
            setPage(1)
          }}
        >
          <option value="">Any role</option>
          {CONTACT_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !contacts.length ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <Users className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 font-medium">No {t.plural('contact').toLowerCase()} found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            People are added from an {t('account').toLowerCase()}&rsquo;s Contacts tab.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {contacts.map((ct) => (
            <ContactRow key={ct.id} contact={ct} />
          ))}
        </div>
      )}

      {(data?.totalPages ?? 1) > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-muted-foreground">
            {page} of {data?.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= (data?.totalPages ?? 1)}
            className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

function ContactRow({ contact }: { contact: Contact }) {
  const role = CONTACT_ROLES.find((r) => r.value === contact.role)
  const strength = RELATIONSHIP_STRENGTHS.find((r) => r.value === contact.relationshipStrength)

  return (
    <Link
      to="/app/contacts/$contactId"
      params={{ contactId: String(contact.id) }}
      className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4 hover:border-primary/40"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
        {contact.firstName.slice(0, 1).toUpperCase()}
        {contact.lastName?.slice(0, 1).toUpperCase() ?? ''}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-semibold">{contact.fullName}</p>
          {role && role.value !== 'unknown' && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
              {role.label}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {[contact.jobTitle, contact.account?.name].filter(Boolean).join(' · ') || 'No company'}
        </p>
      </div>

      <div className="text-right text-xs text-muted-foreground">
        {contact.email && <p className="truncate">{contact.email}</p>}
        {contact.mobile && <p>{contact.mobile}</p>}
        {strength && strength.value !== 'unknown' && <p className="mt-1">{strength.label}</p>}
      </div>
    </Link>
  )
}
