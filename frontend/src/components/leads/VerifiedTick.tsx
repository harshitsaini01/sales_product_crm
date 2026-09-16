import { BadgeCheck } from 'lucide-react'
import { useVerifiedValues } from '@/hooks/useVerifiedValues'

interface Props {
  field: string
  value: string | null | undefined
  className?: string
  size?: number
}

/**
 * Renders a green verified-check icon iff (field, value) is in the verified
 * dictionary. Exact string match — case-sensitive by design. Anything that
 * doesn't match (typos, casing variants) stays unmarked so admins can find
 * and clean it up.
 */
export function VerifiedTick({ field, value, className = '', size = 14 }: Props) {
  const { isVerified } = useVerifiedValues()
  if (!isVerified(field, value)) return null
  return (
    <BadgeCheck
      className={'inline-block text-emerald-500 shrink-0 ' + className}
      style={{ width: size, height: size }}
    />
  )
}
