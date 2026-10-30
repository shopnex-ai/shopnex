import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect } from 'react'

/** Opens a create dialog when the URL has ?new=1 (the search palette links here), then drops the param */
export function useOpenOnNew(open: () => void, enabled = true) {
  const navigate = useNavigate()
  // Shared by list routes that don't declare it
  const searchParams: Record<string, unknown> = useSearch({ strict: false })
  const requested = String(searchParams.new ?? '') === '1'

  useEffect(() => {
    if (!enabled || !requested) return
    open()
    navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => {
        const { new: _, ...rest } = prev
        return rest
      },
      replace: true,
      resetScroll: false,
    })
    // `open` only sets state; re-running on its identity would reopen the dialog
  }, [enabled, requested, navigate])
}
