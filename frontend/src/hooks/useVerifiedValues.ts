import { useQuery } from '@tanstack/react-query'
import { verifiedApi } from '@/lib/api'

/**
 * Cached fetch of every verified value across every field.
 * Consumers use verifiedSets[field].has(value) to render the green tick.
 * Invalidate the ['verified-all-fields'] query key after any verify/unverify mutation.
 */
export function useVerifiedValues() {
  const { data } = useQuery({
    queryKey: ['verified-all-fields'],
    queryFn: () => verifiedApi.allFields(),
    staleTime: 5 * 60 * 1000,
  })

  const verifiedSets: Record<string, Set<string>> = {}
  if (data) {
    for (const [field, values] of Object.entries(data)) {
      verifiedSets[field] = new Set(values.map((v) => v.value))
    }
  }

  return {
    verifiedSets,
    isVerified: (field: string, value: string | null | undefined) =>
      !!value && !!verifiedSets[field]?.has(value),
    raw: data,
  }
}
