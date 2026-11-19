import type { ReactNode } from 'react'

/** What a list or panel shows when there is nothing to show yet: one sentence and, if there is one, the way forward */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <p>{children}</p>
      {action}
    </div>
  )
}
