import { useMemo } from 'react'
import { useAuthStore } from '@/stores/auth.store'

/**
 * Which lead fields this customer sees.
 *
 * A super admin can switch fields off per customer (Super Admin → Customer →
 * Lead Fields). Every screen that renders, collects or filters on a lead field
 * should go through this hook so they all agree.
 *
 * THREE THINGS THAT ARE NOT THE SAME
 *
 *   Screens      hidden field is not rendered
 *   Database     column and values untouched, forever
 *   Incoming     /v1 ingestion and CSV import still accept it
 *
 * Hiding is presentation. It never deletes a value and never drops data on the
 * way in — turning a field back on shows everything that was collected while it
 * was off.
 *
 * IMPORTANT when building an edit form: render from the filtered list, but build
 * the form STATE from the full list. Otherwise saving a lead blanks every hidden
 * field, which is silent, permanent data loss.
 */
export function useLeadFields() {
  const config = useAuthStore((s) => s.leadFields)

  return useMemo(() => {
    // Default to visible. Before /auth/me lands the config is empty, and a blank
    // form on first paint is far worse than briefly showing a field that is off.
    const hiddenGroups = new Set(config?.hiddenGroups ?? [])
    // The server flattens groups into field keys, so `visible('neetQualified')`
    // is correct without the caller knowing it lives in the `neet` group. Falls
    // back to the raw list for a token minted before that shipped.
    const hiddenFields = new Set(config?.hiddenFieldKeys ?? config?.hiddenFields ?? [])
    const renames = config?.labels ?? {}
    const groupRenames = config?.groupLabels ?? {}

    /**
     * What this customer calls one lead field. Renaming is presentation only —
     * the Prisma property and the column keep their names, so `intrestedCourse`
     * is still `intrestedCourse` in every query, import and API response even
     * when the form above it reads "Product / Service".
     */
    const label = (fieldKey: string, fallback: string): string =>
      renames[fieldKey] ?? fallback

    /** The same, for a section heading. */
    const groupLabel = (groupId: string, fallback: string): string =>
      groupRenames[groupId] ?? fallback

    /** Is this field shown? Pass its group id when you know it. */
    const visible = (fieldKey: string, groupId?: string): boolean => {
      if (groupId && hiddenGroups.has(groupId)) return false
      return !hiddenFields.has(fieldKey)
    }

    const groupVisible = (groupId: string): boolean => !hiddenGroups.has(groupId)

    /** Filter any array of objects that carry a field key under `prop`. */
    function filterFields<T>(items: T[], prop: keyof T = 'key' as keyof T): T[] {
      return items.filter((item) => visible(String(item[prop])))
    }

    /**
     * Filter grouped sections, dropping fields, then any group left empty — so a
     * heading never survives with nothing under it.
     */
    function filterSections<
      S extends { id: string; title?: string; fields: F[] },
      F extends { key: string; label?: string; type?: string },
    >(sections: S[]): S[] {
      return sections
        .filter((s) => groupVisible(s.id))
        .map((s) => ({
          ...s,
          // Renames are applied here as well as filtering, so a caller that
          // maps over the result gets this customer's wording without having
          // to remember to call label() on every field itself.
          title: s.title === undefined ? s.title : groupLabel(s.id, s.title),
          fields: s.fields
            .filter((f) => !hiddenFields.has(f.key))
            .map((f) => (f.label === undefined ? f : { ...f, label: label(f.key, f.label) })),
        }))
        .filter((s) => s.fields.length > 0)
    }

    return {
      visible,
      groupVisible,
      label,
      groupLabel,
      filterFields,
      filterSections,
      /** True when this customer has hidden or renamed nothing — the common case. */
      isDefault:
        hiddenGroups.size === 0 &&
        hiddenFields.size === 0 &&
        Object.keys(renames).length === 0 &&
        Object.keys(groupRenames).length === 0,
    }
  }, [config])
}
