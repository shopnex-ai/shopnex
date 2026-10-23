import { useRouterState } from '@tanstack/react-router'

// Thin bar at the top while a navigation is loading, so a click gives feedback before the page swaps
export function NavigationProgress() {
  const loading = useRouterState({ select: (state) => state.isLoading })
  if (!loading) return null
  return (
    <div
      className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/20"
      role="progressbar"
      aria-label="Loading"
    >
      <div className="h-full w-1/3 animate-pulse bg-primary" />
    </div>
  )
}
