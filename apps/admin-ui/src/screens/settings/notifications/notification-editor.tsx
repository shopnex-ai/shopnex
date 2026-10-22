'use client'

// Edit one notification's Liquid: subject and body, with a live preview rendered by the server from the shop's
// latest order (or a sample one), a test send to yourself, and revert to the built-in default.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { LiquidEditor } from '@/components/admin/liquid-editor'
import { PageHeader } from '@/components/admin/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { orpc, type Outputs } from '@/lib/orpc'

type Notification = Outputs['admin']['notifications']['get']['notification']
type Template = Outputs['admin']['notifications']['get']

// What templates can use; the defaults show them in context
const VARIABLES: [string, string][] = [
  ['shop.name, shop.url, shop.logo_url', 'Your shop'],
  ['order.name', 'Order number, like #1001'],
  ['order.customer.first_name, order.customer.name, order.email', 'The customer'],
  ['order.line_items', 'Each has title, variant_title, quantity, price, line_price, image_url'],
  [
    'order.subtotal_price, order.shipping_price, order.total_discounts, order.total_tax, order.total_price',
    'Amounts: use | money',
  ],
  ['order.shipping_address, order.billing_address', 'name, address1, address2, city, province, zip, country'],
  ['order.shipping_method.title, order.payment_method, order.payment_instructions', 'Chosen at checkout'],
  ['order.financial_status, order.cancel_reason, order.note, order.created_at', 'Order details'],
  ['order.admin_url', 'The order in your admin (staff emails)'],
  ['fulfillment.tracking_company, fulfillment.tracking_number, fulfillment.tracking_url', 'Shipping confirmation'],
  ['content_for_layout, subject', 'Layout only: the email inside it, and its subject'],
]

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export function NotificationEditor({ notification }: { notification: Notification }) {
  const { data, error } = useQuery(orpc.admin.notifications.get.queryOptions({ input: { notification } }))
  if (error) return <p className="text-sm text-destructive">{error.message}</p>
  if (!data) return <Skeleton className="h-96 w-full" />
  return <Editor template={data} />
}

function Editor({ template }: { template: Template }) {
  const { notification } = template
  const queryClient = useQueryClient()
  const [subject, setSubject] = useState(template.subject)
  const [body, setBody] = useState(template.body)
  const [saved, setSaved] = useState({ subject: template.subject, body: template.body })
  // Remounts the editor when its content is replaced from outside (revert)
  const [generation, setGeneration] = useState(0)
  const [line, setLine] = useState<number | null>(null)

  const update = useMutation(orpc.admin.notifications.update.mutationOptions())
  const revert = useMutation(orpc.admin.notifications.revert.mutationOptions())
  const test = useMutation(orpc.admin.notifications.test.mutationOptions())

  const source = useDebounced({ subject, body }, 400)
  const preview = useQuery({
    ...orpc.admin.notifications.preview.queryOptions({ input: { notification, ...source } }),
    placeholderData: keepPreviousData,
  })

  const isLayout = notification === 'layout'
  const dirty = subject !== saved.subject || body !== saved.body
  const isDefault = subject === template.defaults.subject && body === template.defaults.body

  const stored = (next: Template, message: string) => {
    queryClient.setQueryData(orpc.admin.notifications.get.queryKey({ input: { notification } }), next)
    void queryClient.invalidateQueries({ queryKey: orpc.admin.notifications.list.queryKey() })
    setSaved({ subject: next.subject, body: next.body })
    toast.success(message)
  }

  const save = async () => {
    if (!dirty || update.isPending) return
    try {
      stored(await update.mutateAsync({ notification, subject, body }), `${template.title} saved`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save')
    }
  }

  const revertToDefault = async () => {
    try {
      const next = await revert.mutateAsync({ notification })
      setSubject(next.subject)
      setBody(next.body)
      setGeneration((g) => g + 1)
      stored(next, `${template.title} is back to the default`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not revert')
    }
  }

  const sendTest = async () => {
    try {
      const { to } = await test.mutateAsync({ notification, subject, body })
      toast.success(`Test email sent to ${to}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send')
    }
  }

  const problem = preview.data?.problem

  return (
    <>
      <PageHeader
        back={{ to: '/admin/settings/notifications', label: 'Notifications' }}
        title={
          <span className="flex items-center gap-2">
            {template.title}
            {template.customized && !dirty && <Badge variant="secondary">Edited</Badge>}
            {dirty && <Badge variant="outline">Unsaved</Badge>}
          </span>
        }
        description={template.description}
        actions={
          <div className="flex flex-wrap gap-2">
            {!isDefault && (
              <Button variant="ghost" disabled={revert.isPending} onClick={() => void revertToDefault()}>
                Revert to default
              </Button>
            )}
            <Button variant="outline" disabled={test.isPending || Boolean(problem)} onClick={() => void sendTest()}>
              {test.isPending ? 'Sending…' : 'Send test to me'}
            </Button>
            <Button disabled={!dirty || update.isPending} onClick={() => void save()}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="space-y-4">
          {!isLayout && (
            <div className="space-y-2">
              <Label htmlFor="notification-subject">Subject</Label>
              <Input
                id="notification-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>{isLayout ? 'Layout (HTML)' : 'Body (HTML)'}</Label>
            <div className="h-[28rem] overflow-hidden rounded-lg shadow-field focus-within:ring-3 focus-within:ring-ring/50">
              <LiquidEditor key={generation} value={body} onChange={setBody} onSave={() => void save()} line={line} />
            </div>
          </div>
          {problem && (
            <p className="text-sm text-destructive">
              {problem.line ? (
                <button type="button" className="underline" onClick={() => setLine(problem.line)}>
                  Line {problem.line}
                </button>
              ) : null}
              {problem.line ? ': ' : ''}
              {problem.message}
            </p>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Variables you can use</summary>
            <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
              {VARIABLES.map(([name, description]) => (
                <div key={name} className="contents">
                  <dt className="font-mono text-xs break-words">{name}</dt>
                  <dd className="text-muted-foreground">{description}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-muted-foreground">
              Output is HTML-escaped. Filters: <code>money</code>, <code>pluralize</code>, <code>newline_to_br</code>,
              and Liquid’s standard ones like <code>date</code> and <code>default</code>.
            </p>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>
            {preview.data?.sample === false ? 'With your latest order.' : 'With a sample order.'}
            {!isLayout && preview.data?.subject ? (
              <>
                {' '}
                Subject: <span className="text-foreground">{preview.data.subject}</span>
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {preview.data ? (
            // No scripts or same-origin access: the preview is only looked at
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={preview.data.html}
              className="h-[40rem] w-full rounded-lg bg-white shadow-field"
            />
          ) : preview.error ? (
            <p className="text-sm text-destructive">{preview.error.message}</p>
          ) : (
            <Skeleton className="h-96 w-full" />
          )}
        </CardContent>
      </Card>
    </>
  )
}
