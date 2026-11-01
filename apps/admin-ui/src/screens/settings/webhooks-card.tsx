'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CopyIcon, EyeIcon, EyeOffIcon, PlusIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form'
import { toast } from 'sonner'
import { WEBHOOK_TOPICS, webhookEndpointInput, type WebhookTopic } from '@shopnex/api/schemas'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { DialogDeleteButton } from '@/components/admin/dialog-delete-button'
import { CheckboxField, FormError, TextField, setServerError, useZodForm } from '@/components/admin/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { formatDateTime } from '@/lib/format'
import { orpc, type Outputs } from '@/lib/orpc'

type Endpoint = Outputs['admin']['webhooks']['list'][number]
type Delivery = Outputs['admin']['webhooks']['deliveries']['items'][number]

const col = columnHelper<Endpoint>()
const columns = [
  col.accessor('url', {
    header: 'Endpoint',
    cell: ({ row: { original: e } }) => (
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-xs">{e.url}</span>
          {!e.active && <Badge variant="outline">Disabled</Badge>}
        </div>
        {e.apiTokenName && (
          <div className="truncate text-xs text-muted-foreground">
            Created by {e.createdByApp ? 'app' : 'API token'} “{e.apiTokenName}”
          </div>
        )}
        {e.description && <div className="truncate text-muted-foreground">{e.description}</div>}
      </div>
    ),
    meta: { className: 'max-w-72' },
  }),
  col.accessor('topics', {
    header: 'Events',
    cell: ({ row: { original: e } }) => (
      <span className="text-muted-foreground" title={e.topics.join(', ')}>
        {e.topics.length === 1 ? e.topics[0] : `${e.topics.length} events`}
      </span>
    ),
  }),
  col.display({
    id: 'actions',
    cell: ({ row: { original: e } }) => (
      <div className="flex justify-end gap-1">
        <DeliveriesSheet endpoint={e} />
        <EndpointDialog endpoint={e} />
      </div>
    ),
    meta: { className: 'text-right' },
  }),
]

export function WebhooksCard() {
  const { data, error, isPending } = useQuery(orpc.admin.webhooks.list.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhooks</CardTitle>
        <CardDescription>
          Shopnex POSTs a signed JSON payload to your URL when orders, products or customers change — connect Zapier,
          n8n, Make or your own app. Failed deliveries are retried for about a day.
        </CardDescription>
        <CardAction>
          <EndpointDialog />
        </CardAction>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={data}
          getRowId={(e) => e.id}
          isPending={isPending}
          error={error}
          empty="No webhooks yet."
        />
      </CardContent>
    </Card>
  )
}

const empty = { url: '', description: null, topics: [] as WebhookTopic[], active: true }

// Create when `endpoint` is omitted, otherwise edit (or delete) it
function EndpointDialog({ endpoint }: { endpoint?: Endpoint }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const toValues = () =>
    endpoint
      ? { url: endpoint.url, description: endpoint.description, topics: endpoint.topics, active: endpoint.active }
      : empty
  const form = useZodForm(webhookEndpointInput, { defaultValues: toValues() })
  const create = useMutation(orpc.admin.webhooks.create.mutationOptions())
  const update = useMutation(orpc.admin.webhooks.update.mutationOptions())
  const remove = useMutation(orpc.admin.webhooks.delete.mutationOptions())
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.webhooks.key() })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (endpoint) await update.mutateAsync({ id: endpoint.id, ...values })
      else await create.mutateAsync(values)
      await refresh()
      toast.success(endpoint ? 'Webhook saved' : 'Webhook added')
      setOpen(false)
    } catch (error) {
      setServerError(form, error)
    }
  })

  async function onDelete() {
    try {
      await remove.mutateAsync({ id: endpoint!.id })
      await refresh()
      toast.success('Webhook deleted')
      setOpen(false)
    } catch (error) {
      setServerError(form, error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) form.reset(toValues())
      }}
    >
      <DialogTrigger render={<Button variant={endpoint ? 'ghost' : 'outline'} size="sm" />}>
        {endpoint ? (
          'Edit'
        ) : (
          <>
            <PlusIcon />
            Add webhook
          </>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{endpoint ? 'Edit webhook' : 'Add webhook'}</DialogTitle>
          <DialogDescription>
            We&apos;ll POST to this URL whenever one of the selected events happens.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField
              control={form.control}
              name="url"
              label="URL"
              type="url"
              placeholder="https://hooks.zapier.com/…"
              autoComplete="off"
            />
            <TextField
              control={form.control}
              name="description"
              label="Description"
              nullable
              placeholder="Zapier: new orders to Slack"
              autoComplete="off"
            />
            <TopicsField control={form.control} />
            {endpoint && (
              <CheckboxField
                control={form.control}
                name="active"
                label="Active"
                description="Disabled webhooks receive nothing; deliveries waiting for a retry are dropped."
              />
            )}
            <FormError form={form} />
            <Field orientation="horizontal" className="justify-between">
              {endpoint ? <DialogDeleteButton onDelete={onDelete} pending={remove.isPending} /> : <span />}
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving…' : endpoint ? 'Save' : 'Add webhook'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Topics grouped by resource: order.created → Order / created
const groups = Object.entries(
  WEBHOOK_TOPICS.reduce<Record<string, WebhookTopic[]>>((acc, t) => {
    ;(acc[t.split('.')[0]!] ??= []).push(t)
    return acc
  }, {}),
)

function TopicsField<T extends FieldValues>({ control }: { control: Control<T, any, any> }) {
  const id = useId()
  const { field, fieldState } = useController({ control, name: 'topics' as FieldPath<T> })
  const selected = new Set<WebhookTopic>(field.value)
  const toggle = (topic: WebhookTopic, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(topic)
    else next.delete(topic)
    field.onChange(WEBHOOK_TOPICS.filter((t) => next.has(t)))
  }
  return (
    <Field data-invalid={fieldState.error ? true : undefined}>
      <FieldLabel id={id}>Events</FieldLabel>
      <div role="group" aria-labelledby={id} className="grid grid-cols-3 gap-4">
        {groups.map(([resource, topics]) => (
          <div key={resource} className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground capitalize">{resource}</div>
            {topics.map((topic) => (
              <label key={topic} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(topic)}
                  onChange={(e) => toggle(topic, e.target.checked)}
                  onBlur={field.onBlur}
                  className="size-4 accent-primary"
                />
                {topic.split('.')[1]}
              </label>
            ))}
          </div>
        ))}
      </div>
      <FieldDescription>
        Payload: <code>{'{ type, timestamp, shopId, data }'}</code>, where <code>data</code> is the order, product or
        customer as the admin API returns it.
      </FieldDescription>
      <FieldError errors={[fieldState.error]} />
    </Field>
  )
}

const PAGE_SIZE = 20

const statusBadge = (d: Delivery) =>
  d.status === 'succeeded' ? (
    <Badge variant="secondary">Delivered</Badge>
  ) : d.status === 'failed' ? (
    <Badge variant="destructive">Failed</Badge>
  ) : d.attempts > 0 ? (
    <Badge variant="outline">Retrying</Badge>
  ) : (
    <Badge variant="outline">Pending</Badge>
  )

const deliveryCol = columnHelper<Delivery>()
const deliveryColumns = [
  deliveryCol.accessor('topic', {
    header: 'Event',
    cell: ({ row: { original: d } }) => (
      <div className="min-w-0">
        <div className="font-mono text-xs">{d.topic}</div>
        <div className="text-xs text-muted-foreground tabular-nums">{formatDateTime(d.createdAt)}</div>
      </div>
    ),
  }),
  deliveryCol.accessor('status', {
    header: 'Status',
    cell: ({ row: { original: d } }) => (
      <div className="space-y-1">
        {statusBadge(d)}
        {d.lastError && (
          <div className="max-w-48 truncate text-xs text-muted-foreground" title={d.lastError}>
            {d.responseStatus ? `${d.responseStatus} · ` : ''}
            {d.lastError}
          </div>
        )}
        {!d.lastError && d.responseStatus && <div className="text-xs text-muted-foreground">{d.responseStatus}</div>}
      </div>
    ),
  }),
  deliveryCol.accessor('attempts', { header: 'Tries', meta: { className: 'tabular-nums' } }),
  deliveryCol.display({
    id: 'actions',
    cell: ({ row: { original: d } }) => (d.status === 'pending' ? null : <RedeliverButton delivery={d} />),
    meta: { className: 'text-right' },
  }),
]

// Signing secret, test button and the delivery log of one endpoint
function DeliveriesSheet({ endpoint }: { endpoint: Endpoint }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const deliveries = useQuery({
    ...orpc.admin.webhooks.deliveries.queryOptions({
      input: { endpointId: endpoint.id, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
    }),
    enabled: open,
    // Watch pending deliveries and test pings land
    refetchInterval: 5000,
  })
  const sendTest = useMutation(orpc.admin.webhooks.sendTest.mutationOptions())

  async function onSendTest() {
    try {
      await sendTest.mutateAsync({ id: endpoint.id })
      setPage(1)
      await queryClient.invalidateQueries({ queryKey: orpc.admin.webhooks.deliveries.key() })
      toast.success('Test event queued')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send test')
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="sm" />}>Deliveries</SheetTrigger>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Webhook deliveries</SheetTitle>
          <SheetDescription className="truncate font-mono text-xs">{endpoint.url}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-6">
          <SigningSecret endpoint={endpoint} />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Recent deliveries</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={onSendTest}
                disabled={sendTest.isPending || !endpoint.active}
              >
                Send test event
              </Button>
            </div>
            <DataTable
              columns={deliveryColumns}
              data={deliveries.data?.items}
              getRowId={(d) => d.id}
              isPending={deliveries.isPending}
              error={deliveries.error}
              empty="Nothing sent yet."
              pagination={{ page, pageSize: PAGE_SIZE, total: deliveries.data?.total, onPageChange: setPage }}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function SigningSecret({ endpoint }: { endpoint: Endpoint }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="space-y-2">
      <h3 className="font-medium">Signing secret</h3>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-2 py-1.5 font-mono text-xs">
          {shown ? endpoint.secret : 'whsec_' + '•'.repeat(24)}
        </code>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={shown ? 'Hide secret' : 'Show secret'}
          onClick={() => setShown(!shown)}
        >
          {shown ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Copy secret"
          onClick={async () => {
            await navigator.clipboard.writeText(endpoint.secret)
            toast.success('Secret copied')
          }}
        >
          <CopyIcon />
        </Button>
        <RotateSecretButton endpoint={endpoint} />
      </div>
      <p className="text-xs text-muted-foreground">
        Requests follow the{' '}
        <a href="https://www.standardwebhooks.com" target="_blank" rel="noreferrer" className="underline">
          Standard Webhooks
        </a>{' '}
        spec: verify the <code>webhook-signature</code> header with this secret, and use <code>webhook-id</code> to
        ignore duplicates.
      </p>
    </div>
  )
}

function RotateSecretButton({ endpoint }: { endpoint: Endpoint }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const rotate = useMutation(orpc.admin.webhooks.rotateSecret.mutationOptions())

  async function onRotate() {
    try {
      await rotate.mutateAsync({ id: endpoint.id })
      await queryClient.invalidateQueries({ queryKey: orpc.admin.webhooks.list.key() })
      toast.success('Secret rotated')
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not rotate secret')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Rotate</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotate signing secret?</DialogTitle>
          <DialogDescription>
            The current secret stops working immediately: update it wherever this webhook is received.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button variant="destructive" onClick={onRotate} disabled={rotate.isPending}>
            {rotate.isPending ? 'Rotating…' : 'Rotate secret'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RedeliverButton({ delivery }: { delivery: Delivery }) {
  const queryClient = useQueryClient()
  const redeliver = useMutation(orpc.admin.webhooks.redeliver.mutationOptions())
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={redeliver.isPending}
      onClick={async () => {
        try {
          await redeliver.mutateAsync({ id: delivery.id })
          await queryClient.invalidateQueries({ queryKey: orpc.admin.webhooks.deliveries.key() })
          toast.success('Queued for redelivery')
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Could not redeliver')
        }
      }}
    >
      Redeliver
    </Button>
  )
}
