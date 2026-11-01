import { LockIcon } from 'lucide-react'

export function NoAccess({ message }: { message: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <LockIcon className="size-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Access restricted</h2>
        <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}
