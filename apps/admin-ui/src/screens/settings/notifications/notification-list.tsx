'use client'

// Settings → Notifications: the emails Shopnex sends by itself, each with its own Liquid (Edit), and the
// recent ones with their status.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { orpc, type Outputs } from '@/lib/orpc'

type Item = Outputs['admin']['notifications']['list'][number]
type Delivery = Outputs['admin']['notifications']['deliveries'][number]

const GROUPS: { audience: Item['audience']; title: string; description: string }[] = [
  { audience: 'customer', title: 'Customer notifications', description: 'Sent to the email on the order.' },
  { audience: 'staff', title: 'Staff notifications', description: 'Sent to the shop owners.' },
  { audience: 'layout', title: 'Layout', description: 'Shared by every email: your logo, header and footer.' },
]

export function NotificationList() {
  const settings = useQuery(orpc.admin.email.get.queryOptions())
  const { data, error } = useQuery(orpc.admin.notifications.list.queryOptions())
  return (
    <>
      {settings.data?.provider === 'off' && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span>Email is off, so these aren't sent yet.</span>
            <Button size="sm" render={<Link to="/admin/settings/email" />}>
              Set up email
            </Button>
          </CardContent>
        </Card>
      )}
      {GROUPS.map((group) => (
        <Card key={group.audience}>
          <CardHeader>
            <CardTitle>{group.title}</CardTitle>
            <CardDescription>{group.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {data ? (
              <ul className="divide-y">
                {data
                  .filter((n) => n.audience === group.audience)
                  .map((n) => (
                    <NotificationRow key={n.notification} item={n} />
                  ))}
              </ul>
            ) : error ? (
              <p className="text-sm text-destructive">{error.message}</p>
            ) : (
              <Skeleton className="h-12 w-full" />
            )}
          </CardContent>
        </Card>
      ))}
      <RecentEmails />
    </>
  )
}

function NotificationRow({ item }: { item: Item }) {
  const queryClient = useQueryClient()
  const update = useMutation(orpc.admin.notifications.update.mutationOptions())
  const toggle = async () => {
    try {
      await update.mutateAsync({ notification: item.notification, enabled: !item.enabled })
      await queryClient.invalidateQueries({ queryKey: orpc.admin.notifications.list.queryKey() })
      toast.success(`${item.title} ${item.enabled ? 'turned off' : 'turned on'}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save')
    }
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-medium">
          {item.title}
          {item.customized && <Badge variant="secondary">Edited</Badge>}
          {!item.enabled && <Badge variant="outline">Off</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{item.description}</p>
      </div>
      <div className="flex gap-1">
        {item.audience !== 'layout' && (
          <Button variant="ghost" size="sm" disabled={update.isPending} onClick={() => void toggle()}>
            {item.enabled ? 'Turn off' : 'Turn on'}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          render={
            <Link to="/admin/settings/notifications/$notification" params={{ notification: item.notification }} />
          }
        >
          Edit
        </Button>
      </div>
    </li>
  )
}

const statusBadge = (d: Delivery) =>
  d.status === 'sent' ? (
    <Badge variant="secondary">Sent</Badge>
  ) : d.status === 'failed' ? (
    <Badge variant="destructive">Failed</Badge>
  ) : d.status === 'skipped' ? (
    <Badge variant="outline">Not sent</Badge>
  ) : d.attempts > 0 ? (
    <Badge variant="outline">Retrying</Badge>
  ) : (
    <Badge variant="outline">Queued</Badge>
  )

const col = columnHelper<Delivery>()
const columns = [
  col.accessor('subject', {
    header: 'Email',
    cell: ({ row: { original: d } }) => (
      <div className="min-w-0">
        {d.orderId ? (
          <Link to="/admin/orders/$id" params={{ id: d.orderId }} className="block truncate hover:underline">
            {d.subject}
          </Link>
        ) : (
          <div className="truncate">{d.subject}</div>
        )}
        <div className="truncate text-xs text-muted-foreground">
          To {d.to} · <span className="tabular-nums">{formatDateTime(d.createdAt)}</span>
        </div>
      </div>
    ),
    meta: { className: 'max-w-80' },
  }),
  col.accessor('status', {
    header: 'Status',
    cell: ({ row: { original: d } }) => (
      <div className="space-y-1">
        {statusBadge(d)}
        {d.lastError && d.status !== 'sent' && (
          <div className="max-w-56 truncate text-xs text-muted-foreground" title={d.lastError}>
            {d.lastError}
          </div>
        )}
      </div>
    ),
  }),
]

function RecentEmails() {
  const { data, error, isPending } = useQuery({
    ...orpc.admin.notifications.deliveries.queryOptions(),
    refetchInterval: 10_000,
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent emails</CardTitle>
        <CardDescription>
          The last notifications your shop sent. Failed sends are retried for a few hours.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={data}
          getRowId={(d) => d.id}
          isPending={isPending}
          error={error}
          empty="No emails sent yet."
        />
      </CardContent>
    </Card>
  )
}
