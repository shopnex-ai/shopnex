'use client'

import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/format'
import { orpc } from '@/lib/orpc'

export type Publication = { channelId: string; publishedAt: Date | string }

const isScheduled = (p: Publication) => new Date(p.publishedAt).getTime() > Date.now()

/** Names of the channels a resource is live on now, for lists */
export function publishedOn(publications: Publication[], channels: { id: string; name: string }[] | undefined) {
  const names = publications
    .filter((p) => !isScheduled(p))
    .map((p) => channels?.find((c) => c.id === p.channelId)?.name)
    .filter((name): name is string => !!name)
  if (!names.length) return null
  return names.length === 1 ? names[0]! : `${names.length} channels`
}

/**
 * Where a product or collection is published: a checkbox per sales channel, saved right away. A channel with
 * a future date stays scheduled until it's unchecked (the API keeps its date when the rest changes).
 */
export function ChannelPicker({
  publications,
  isPending,
  saving,
  onSave,
}: {
  publications: Publication[] | undefined
  isPending: boolean
  saving: boolean
  onSave: (channelIds: string[]) => void
}) {
  const channels = useQuery(orpc.admin.channels.list.queryOptions())
  if (isPending || channels.isPending) return <Skeleton className="h-16 w-full" />
  if (channels.error) return <p className="text-sm text-destructive">{channels.error.message}</p>

  const current = publications ?? []
  const toggle = (channelId: string, on: boolean) => {
    const ids = current.map((p) => p.channelId).filter((id) => id !== channelId)
    onSave(on ? [...ids, channelId] : ids)
  }

  return (
    <ul className="space-y-2">
      {channels.data.map((channel) => {
        const publication = current.find((p) => p.channelId === channel.id)
        return (
          <li key={channel.id}>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={!!publication}
                disabled={saving}
                onChange={(e) => toggle(channel.id, e.target.checked)}
              />
              <span>
                <span className="font-medium">{channel.name}</span>
                {publication && isScheduled(publication) && (
                  <span className="block text-xs text-muted-foreground">
                    Scheduled for {formatDate(publication.publishedAt)}
                  </span>
                )}
              </span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}
