'use client'

import { SearchIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'

// Debounced: calls onSearch once typing pauses, not on every keystroke
export function SearchInput({
  value,
  onSearch,
  placeholder = 'Search…',
  delay = 300,
}: {
  value: string
  onSearch: (value: string) => void
  placeholder?: string
  delay?: number
}) {
  const [draft, setDraft] = useState(value)

  // Follow outside changes (back/forward navigation)
  useEffect(() => setDraft(value), [value])

  useEffect(() => {
    if (draft.trim() === value) return
    const timer = setTimeout(() => onSearch(draft.trim()), delay)
    return () => clearTimeout(timer)
  }, [draft, value, onSearch, delay])

  return (
    <div className="relative w-full max-w-sm">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-8"
      />
    </div>
  )
}
