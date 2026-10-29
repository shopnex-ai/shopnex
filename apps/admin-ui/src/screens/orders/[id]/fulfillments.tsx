'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { fulfillmentUpdateInput, SHIPMENT_STATUSES, type ShipmentStatus } from '@shopnex/api/schemas'
import { FormError, TextField, setServerError, useZodForm } from '@/components/admin/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { formatDate, orderName } from '@/lib/format'
import { orpc, type Outputs } from '@/lib/orpc'

type Order = Outputs['admin']['orders']['get']
type Fulfillment = Order['fulfillments'][number]

const shipmentLabel: Record<ShipmentStatus, string> = {
  confirmed: 'Confirmed',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  failure: 'Delivery failed',
}

function useRefreshOrders() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: orpc.admin.orders.key() })
}

/** Ships some or all of what is left (Shopify "Fulfill items"): pick quantities, add tracking */
export function FulfillButton({ order }: { order: Order }) {
  const refresh = useRefreshOrders()
  const [open, setOpen] = useState(false)
  const fulfillable = order.items.filter((i) => i.fulfillableQuantity > 0)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [notifyCustomer, setNotifyCustomer] = useState(true)
  const form = useZodForm(
    fulfillmentUpdateInput.pick({ trackingCompany: true, trackingNumber: true, trackingUrl: true }),
    {
      defaultValues: { trackingCompany: '', trackingNumber: '', trackingUrl: '' },
    },
  )
  const fulfill = useMutation(orpc.admin.orders.fulfill.mutationOptions())

  // Everything that is left, until the staff member changes a quantity
  const quantityOf = (id: string, left: number) => quantities[id] ?? left
  const picked = fulfillable
    .map((i) => ({
      orderItemId: i.id,
      quantity: Math.min(quantityOf(i.id, i.fulfillableQuantity), i.fulfillableQuantity),
    }))
    .filter((i) => i.quantity > 0)
  const everything =
    picked.length === fulfillable.length && picked.every((p, n) => p.quantity === fulfillable[n]!.fulfillableQuantity)

  const onSubmit = form.handleSubmit(async (values) => {
    if (picked.length === 0) {
      form.setError('root', { message: 'Choose at least one item to fulfill.' })
      return
    }
    try {
      await fulfill.mutateAsync({ id: order.id, ...values, items: picked, notifyCustomer })
      await refresh()
      toast.success(everything ? 'Order fulfilled' : 'Items fulfilled')
      setOpen(false)
      setQuantities({})
    } catch (error) {
      setServerError(form, error)
    }
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>Fulfill items</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fulfill {orderName(order.orderNumber)}</DialogTitle>
          <DialogDescription>
            Choose what ships together: each shipment has its own tracking, and you can fulfill the rest later.
            {order.financialStatus === 'pending' ? ' The order is not paid yet.' : ''}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <ul className="divide-y rounded-lg border">
              {fulfillable.map((item) => (
                <li key={item.id} className="flex items-center gap-3 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{item.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[item.variantTitle, item.sku && `SKU ${item.sku}`].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={item.fulfillableQuantity}
                    value={quantityOf(item.id, item.fulfillableQuantity)}
                    onChange={(e) => setQuantities((q) => ({ ...q, [item.id]: Number(e.target.value) }))}
                    aria-label={`Quantity of ${item.title} to fulfill`}
                    className="w-20 text-right tabular-nums"
                  />
                  <span className="w-12 text-xs text-muted-foreground tabular-nums">of {item.fulfillableQuantity}</span>
                </li>
              ))}
            </ul>
            <TextField control={form.control} name="trackingNumber" label="Tracking number" autoComplete="off" />
            <TextField
              control={form.control}
              name="trackingCompany"
              label="Shipping carrier"
              placeholder="DHL, UPS…"
              autoComplete="off"
            />
            <TextField control={form.control} name="trackingUrl" label="Tracking URL" type="url" autoComplete="off" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={notifyCustomer} onChange={(e) => setNotifyCustomer(e.target.checked)} />
              Email the customer a shipping confirmation
            </label>
            <FormError form={form} />
            <Field orientation="horizontal" className="justify-end">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Fulfilling…' : everything ? 'Fulfill items' : 'Fulfill selected items'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The order's shipments: what is in each, its tracking and status, with edit and cancel */
export function FulfillmentsCard({ order }: { order: Order }) {
  if (order.fulfillments.length === 0) return null
  const itemOf = new Map(order.items.map((i) => [i.id, i]))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fulfillment</CardTitle>
      </CardHeader>
      <CardContent className="divide-y text-sm">
        {order.fulfillments.map((f) => (
          <div key={f.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{f.status === 'cancelled' ? 'Cancelled shipment' : 'Shipment'}</span>
              <span className="text-muted-foreground">{formatDate(f.createdAt)}</span>
              {f.status === 'cancelled' ? (
                <Badge variant="destructive">Cancelled</Badge>
              ) : (
                f.shipmentStatus && (
                  <Badge variant={f.shipmentStatus === 'failure' ? 'destructive' : 'secondary'}>
                    {shipmentLabel[f.shipmentStatus]}
                    {f.shipmentStatus === 'delivered' && f.deliveredAt ? ` ${formatDate(f.deliveredAt)}` : ''}
                  </Badge>
                )
              )}
            </div>
            <ul className={f.status === 'cancelled' ? 'text-muted-foreground line-through' : undefined}>
              {f.items.map((l) => (
                <li key={l.orderItemId}>
                  {l.quantity} × {itemOf.get(l.orderItemId)?.title ?? 'Item'}
                  {itemOf.get(l.orderItemId)?.variantTitle ? ` · ${itemOf.get(l.orderItemId)!.variantTitle}` : ''}
                </li>
              ))}
            </ul>
            {(f.trackingNumber || f.trackingCompany) && (
              <div className="text-muted-foreground">
                {[f.trackingCompany, f.trackingNumber].filter(Boolean).join(' · ')}
                {f.trackingUrl && (
                  <>
                    {' · '}
                    <a href={f.trackingUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      Track
                    </a>
                  </>
                )}
              </div>
            )}
            {f.status !== 'cancelled' && (
              <div className="flex gap-2">
                <TrackingDialog order={order} fulfillment={f} />
                <CancelFulfillmentButton order={order} fulfillment={f} />
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function TrackingDialog({ order, fulfillment }: { order: Order; fulfillment: Fulfillment }) {
  const refresh = useRefreshOrders()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<ShipmentStatus | ''>(fulfillment.shipmentStatus ?? '')
  const form = useZodForm(
    fulfillmentUpdateInput.pick({ trackingCompany: true, trackingNumber: true, trackingUrl: true }),
    {
      defaultValues: {
        trackingCompany: fulfillment.trackingCompany ?? '',
        trackingNumber: fulfillment.trackingNumber ?? '',
        trackingUrl: fulfillment.trackingUrl ?? '',
      },
    },
  )
  const update = useMutation(orpc.admin.orders.updateFulfillment.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync({
        id: order.id,
        fulfillmentId: fulfillment.id,
        ...values,
        ...(status && status !== fulfillment.shipmentStatus ? { shipmentStatus: status } : {}),
      })
      await refresh()
      toast.success('Shipment updated')
      setOpen(false)
    } catch (error) {
      setServerError(form, error)
    }
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Edit tracking</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit shipment</DialogTitle>
          <DialogDescription>Update the tracking details or where the shipment is.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField control={form.control} name="trackingNumber" label="Tracking number" autoComplete="off" />
            <TextField control={form.control} name="trackingCompany" label="Shipping carrier" autoComplete="off" />
            <TextField control={form.control} name="trackingUrl" label="Tracking URL" type="url" autoComplete="off" />
            <Field>
              <FieldLabel htmlFor="shipment-status">Shipment status</FieldLabel>
              <select
                id="shipment-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as ShipmentStatus | '')}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                {/* An unset status can't be set again, only changed */}
                {!fulfillment.shipmentStatus && <option value="">Not set</option>}
                {SHIPMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {shipmentLabel[s]}
                  </option>
                ))}
              </select>
            </Field>
            <FormError form={form} />
            <Field orientation="horizontal" className="justify-end">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving…' : 'Save'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CancelFulfillmentButton({ order, fulfillment }: { order: Order; fulfillment: Fulfillment }) {
  const refresh = useRefreshOrders()
  const [open, setOpen] = useState(false)
  const cancel = useMutation(orpc.admin.orders.cancelFulfillment.mutationOptions())
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>Cancel shipment</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this shipment?</DialogTitle>
          <DialogDescription>
            Its items go back to unfulfilled and can be fulfilled again. The customer isn&apos;t notified.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Keep shipment</DialogClose>
          <Button
            variant="destructive"
            disabled={cancel.isPending}
            onClick={async () => {
              try {
                await cancel.mutateAsync({ id: order.id, fulfillmentId: fulfillment.id })
                await refresh()
                toast.success('Shipment cancelled')
                setOpen(false)
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Could not cancel the shipment')
              }
            }}
          >
            Cancel shipment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
