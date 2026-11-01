'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { paymentMethodInput } from '@shopnex/api/schemas'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { DialogDeleteButton } from '@/components/admin/dialog-delete-button'
import { CheckboxField, FormError, TextField, TextareaField, setServerError, useZodForm } from '@/components/admin/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup } from '@/components/ui/field'
import { orpc, type Outputs } from '@/lib/orpc'
import { AppIcon, installLink } from '../apps/installed-apps-card'

type Method = Outputs['admin']['paymentMethods']['list'][number]

const col = columnHelper<Method>()
const columns = (installations: Map<string, { id: string; name: string }>) => [
  col.accessor('name', {
    header: 'Name',
    cell: ({ row: { original: m } }) => (
      <span className="flex items-center gap-2">
        {m.name}
        {!m.active && <Badge variant="outline">Inactive</Badge>}
        {m.active && !m.ready && <Badge variant="outline">Setup needed</Badge>}
      </span>
    ),
  }),
  col.display({
    id: 'type',
    header: 'Type',
    cell: ({ row: { original: m } }) => (
      <span className="text-muted-foreground">
        {m.provider === 'app' ? (installations.get(m.appId ?? '')?.name ?? 'App') : 'Manual'}
      </span>
    ),
  }),
  col.display({
    id: 'actions',
    cell: ({ row: { original: m } }) => {
      const installation = m.appId ? installations.get(m.appId) : undefined
      return (
        <span className="inline-flex gap-1">
          {installation && (
            <Button variant="ghost" size="sm" render={<Link to="/admin/apps/$id" params={{ id: installation.id }} />}>
              Manage
            </Button>
          )}
          <MethodDialog method={m} />
        </span>
      )
    },
    meta: { className: 'text-right' },
  }),
]

export function PaymentMethodsCard() {
  const { data, error, isPending } = useQuery(orpc.admin.paymentMethods.list.queryOptions())
  const apps = useQuery(orpc.admin.apps.list.queryOptions())
  // appId → its installation in this shop ("Manage" opens the app)
  const installations = new Map((apps.data ?? []).map((i) => [i.appId, { id: i.id, name: i.app.name }]))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments</CardTitle>
        <CardDescription>
          Payments apps (cards…) take the payment at checkout. Manual methods (bank transfer, cash on delivery…): orders
          are placed unpaid and you mark them as paid when the money arrives. Checkout needs at least one active method.
        </CardDescription>
        <CardAction>
          <MethodDialog />
        </CardAction>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns(installations)}
          data={data}
          getRowId={(m) => m.id}
          isPending={isPending}
          error={error}
          empty="No payment methods — buyers can't check out yet."
        />
      </CardContent>
    </Card>
  )
}

const empty = { name: '', additionalDetails: null, instructions: null, active: true }

// Create when `method` is omitted, otherwise edit (or delete) it
function MethodDialog({ method }: { method?: Method }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  // Uninstalling the app removes it; deleting it here would just be configured again
  const appMethod = method?.provider === 'app'
  const toValues = () =>
    method
      ? {
          name: method.name,
          additionalDetails: method.additionalDetails,
          instructions: method.instructions,
          active: method.active,
        }
      : empty
  const form = useZodForm(paymentMethodInput, { defaultValues: toValues() })
  const create = useMutation(orpc.admin.paymentMethods.create.mutationOptions())
  const update = useMutation(orpc.admin.paymentMethods.update.mutationOptions())
  const remove = useMutation(orpc.admin.paymentMethods.delete.mutationOptions())
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.paymentMethods.key() })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (method) await update.mutateAsync({ id: method.id, ...values })
      else await create.mutateAsync(values)
      await refresh()
      toast.success(method ? 'Payment method saved' : 'Payment method added')
      setOpen(false)
    } catch (error) {
      setServerError(form, error)
    }
  })

  async function onDelete() {
    try {
      await remove.mutateAsync({ id: method!.id })
      await refresh()
      toast.success('Payment method deleted')
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
      <DialogTrigger render={<Button variant={method ? 'ghost' : 'outline'} size="sm" />}>
        {method ? (
          'Edit'
        ) : (
          <>
            <PlusIcon />
            Add manual method
          </>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{method ? 'Edit payment method' : 'Add manual payment method'}</DialogTitle>
          <DialogDescription>
            {appMethod
              ? 'Taken by a payments app. Its settings (keys, accounts) are in the app: Manage.'
              : 'For payments that happen outside Shopnex.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField control={form.control} name="name" label="Name" placeholder="Bank transfer" autoComplete="off" />
            <TextareaField
              control={form.control}
              name="additionalDetails"
              label="Additional details"
              nullable
              rows={2}
              description="Shown when the buyer picks this method at checkout."
            />
            {!appMethod && (
              <TextareaField
                control={form.control}
                name="instructions"
                label="Payment instructions"
                nullable
                rows={4}
                placeholder={'IBAN: …\nUse your order number as the reference.'}
                description="Shown after the order is placed, so the buyer knows how to pay."
              />
            )}
            <CheckboxField control={form.control} name="active" label="Offer at checkout" />
            <FormError form={form} />
            <Field orientation="horizontal" className="justify-between">
              {method && !appMethod ? <DialogDeleteButton onDelete={onDelete} pending={remove.isPending} /> : <span />}
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving…' : method ? 'Save' : 'Add method'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Payments apps that could take card payments here (e.g. the bundled Stripe app). Install opens the app, which
// asks for consent and then registers its payment method.
export function PaymentAppsCard({ shopId }: { shopId: string }) {
  const { data } = useQuery(orpc.admin.paymentApps.available.queryOptions())
  if (!data?.apps.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Accept card payments</CardTitle>
        <CardDescription>Payments apps take the payment at checkout and mark the order as paid.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y surface-inset">
          {data.apps.map((app) => (
            <li key={app.id} className="flex items-center gap-3 p-3">
              <AppIcon url={app.iconUrl} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{app.name}</div>
                {app.description && <div className="text-sm text-muted-foreground">{app.description}</div>}
              </div>
              <Button size="sm" render={<a href={installLink(app, shopId, data.instanceUrl)} />}>
                Install
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
