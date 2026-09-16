import { useEffect, useState } from 'react'

const STORAGE_KEY = 'crm_saved_filters_v1'

export interface SavedFilter<T = Record<string, string>> {
  id: string
  name: string
  scope: string // e.g. 'leads', 'students'
  filters: T
  createdAt: string
}

function readAll(): SavedFilter[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SavedFilter[]) : []
  } catch {
    return []
  }
}

function writeAll(items: SavedFilter[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

/**
 * Per-page-scope saved filter manager backed by localStorage.
 * `scope` lets each page (Leads, Students, etc.) have an independent list.
 */
export function useSavedFilters<T extends Record<string, string>>(scope: string) {
  const [items, setItems] = useState<SavedFilter<T>[]>(() =>
    readAll().filter((f) => f.scope === scope) as SavedFilter<T>[],
  )

  // Refresh on storage events from other tabs
  useEffect(() => {
    const onChange = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      setItems(readAll().filter((f) => f.scope === scope) as SavedFilter<T>[])
    }
    window.addEventListener('storage', onChange)
    return () => window.removeEventListener('storage', onChange)
  }, [scope])

  function save(name: string, filters: T) {
    const all = readAll()
    const trimmedName = name.trim()
    if (!trimmedName) return
    // Replace if same name+scope already exists
    const existingIdx = all.findIndex((f) => f.scope === scope && f.name === trimmedName)
    const entry: SavedFilter<T> = {
      id: existingIdx >= 0 ? all[existingIdx].id : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: trimmedName,
      scope,
      filters,
      createdAt: new Date().toISOString(),
    }
    if (existingIdx >= 0) all[existingIdx] = entry as SavedFilter
    else all.push(entry as SavedFilter)
    writeAll(all)
    setItems(all.filter((f) => f.scope === scope) as SavedFilter<T>[])
  }

  function remove(id: string) {
    const all = readAll().filter((f) => f.id !== id)
    writeAll(all)
    setItems(all.filter((f) => f.scope === scope) as SavedFilter<T>[])
  }

  return { saved: items, save, remove }
}
