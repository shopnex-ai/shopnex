'use client'

import { ORPCError } from '@orpc/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Fragment, useState } from 'react'
import { toast } from 'sonner'
import { CANCEL_REASONS, fulfillOrderInput, type CancelReason } from '@shopnex/api/schemas'
import { AddressLines } from '@/components/admin/address'
import { FormError, TextField, setServerError, useZodForm } from '@/components/admin/form'
import { OrderStatusBadges } from '@/components/admin/order-status'
import { PageHeader } from '@/components/admin/page-header'
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
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, orderName } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import { orpc, type Outputs } from '@/lib/orpc'

type Order = Outputs['admin']['orders']['get']

const back = { to: '/admin/orders', label: 'Orders' } as const

const reasonLabel: Record<CancelReason, string> = {
  customer: 'Customer changed or canceled order',
  declined: 'Payment declined',
  fraud: 'Fraudulent order',
  inventory: 'Items unavailable',
  staff: 'Staff error',
  other: 'Other',
}

const kindLabel: Record<string, string> = {
  sale: 'Payment',
  authorization: 'Authorization',
  capture: 'Capture',
  refund: 'Refund',
  void: 'Void',
}

export function OrderDetail({ id }: { id: string }) {
  const order = useQuery(orpc.admin.orders.get.queryOptions({ input: { id } }))

  if (order.isPending) {
    return (
      <div className="space-y-4">
        <PageHeader back={back} title={<Skeleton className="h-8 w-56" />} />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (order.error) {
    // BAD_REQUEST: the id in the URL isn't a valid uuid
    const notFound =
      order.error instanceof ORPCError && (order.error.code === 'NOT_FOUND' || order.error.code === 'BAD_REQUEST')
    return (
      <div className="space-y-4">
        <PageHeader back={back} title={notFound ? 'Order not found' : 'Could not load order'} />
        <p className="text-muted-foreground">
          {notFound ? 'It may have been removed, or it belongs to another shop.' : order.error.message}
        </p>
      </div>
    )
  }

  const o = order.data
  const money = (cents: number) => formatMoney(cents, o.currency)
  const paidCents = o.transactions
    .filter((t) => t.status === 'success')
    .reduce(
      (sum, t) =>
        sum + (t.kind === 'sale' || t.kind === 'capture' ? t.amountCents : t.kind === 'refund' ? -t.amountCents : 0),
      0,
    )
  const shippingLine = o.shippingLines[0]

  return (
    <div className="space-y-6">
      <PageHeader
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {orderName(o.orderNumber)}
            <OrderStatusBadges order={o} />
          </span>
        }
        description={`Placed ${formatDate(o.createdAt)}${o.cancelledAt ? ` · Cancelled ${formatDate(o.cancelledAt)}${o.cancelReason ? ` (${reasonLabel[o.cancelReason].toLowerCase()})` : ''}` : ''}`}
        actions={<OrderActions order={o} />}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {o.items.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt="" className="size-full object-cover" />
                      ) : (
                        <ImageIcon className="size-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 text-sm">
                      {item.productId ? (
                        <Link
                          to="/admin/products/$id"
                          params={{ id: item.productId }}
                          className="font-medium hover:underline"
                        >
                          {item.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{item.title}</span>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {[item.variantTitle, item.sku && `SKU ${item.sku}`].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="text-sm tabular-nums text-muted-foreground">
                      {money(item.unitPriceCents)} × {item.quantity}
                    </div>
                    <div className="w-24 text-right text-sm tabular-nums">
                      {item.discountCents > 0 ? (
                        <>
                          <div className="text-xs text-muted-foreground line-through">
                            {money(item.unitPriceCents * item.quantity)}
                          </div>
                          {money(item.unitPriceCents * item.quantity - item.discountCents)}
                        </>
                      ) : (
                        money(item.unitPriceCents * item.quantity)
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 tabular-nums">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="text-right">{money(o.subtotalCents)}</dd>
                <dt className="text-muted-foreground">Shipping{shippingLine ? ` · ${shippingLine.title}` : ''}</dt>
                <dd className="text-right">
                  {o.shippingCents === 0 && shippingLine ? 'Free' : money(o.shippingCents)}
                </dd>
                {o.discountCents > 0 && (
                  <>
                    <dt className="text-muted-foreground">
                      Discount{o.discountCodes.length ? ` · ${o.discountCodes.join(', ')}` : ''}
                    </dt>
                    <dd className="text-right">−{money(o.discountCents)}</dd>
                  </>
                )}
                {o.taxLines.map((t) => (
                  <Fragment key={t.title}>
                    <dt className="text-muted-foreground">
                      {t.title} {t.ratePercent}%{o.taxesIncluded ? ' (included)' : ''}
                    </dt>
                    <dd className="text-right">{money(t.amountCents)}</dd>
                  </Fragment>
                ))}
                <dt className="font-semibold">Total</dt>
                <dd className="text-right font-semibold">{money(o.totalCents)}</dd>
                <dt className="text-muted-foreground">Paid by customer</dt>
                <dd className="text-right">{money(Math.max(paidCents, 0))}</dd>
              </dl>
              <p className="text-muted-foreground">
                {o.paymentMethodName ? `Payment method: ${o.paymentMethodName}` : 'No payment method chosen'}
                {o.paymentGateway === 'manual' && o.financialStatus === 'pending' && !o.cancelledAt
                  ? ' — mark the order as paid when you receive the money.'
                  : ''}
              </p>
              {o.transactions.length > 0 && (
                <ul className="space-y-1 border-t pt-3">
                  {o.transactions.map((t) => (
                    <li key={t.id} className="flex justify-between gap-4">
                      <span>
                        {kindLabel[t.kind] ?? t.kind} · {t.gateway}
                        {t.status === 'pending' && <span className="text-muted-foreground"> (pending)</span>}
                        {t.status !== 'success' && t.status !== 'pending' && (
                          <span className="text-destructive">
                            {' '}
                            ({t.status}
                            {t.errorMessage ? `: ${t.errorMessage}` : ''})
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {t.kind === 'refund' ? '−' : ''}
                        {money(t.amountCents)} · {formatDate(t.processedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {o.fulfillments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Fulfillment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {o.fulfillments.map((f) => (
                  <div key={f.id}>
                    <div>Fulfilled {formatDate(f.createdAt)}</div>
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
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {o.customer ? (
                <Link to="/admin/customers/$id" params={{ id: o.customer.id }} className="font-medium hover:underline">
                  {o.customer.name ?? o.customer.email}
                </Link>
              ) : (
                <p className="text-muted-foreground">Customer record removed</p>
              )}
              {/* Contact details the order was placed with (the customer record may have changed since) */}
              <p className="text-muted-foreground">{o.email}</p>
              {o.phone && <p className="text-muted-foreground">{o.phone}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Shipping address</CardTitle>
            </CardHeader>
            <CardContent>
              {o.shippingAddress ? (
                <AddressLines address={o.shippingAddress} />
              ) : (
                <p className="text-sm text-muted-foreground">No shipping address</p>
              )}
            </CardContent>
          </Card>
          {o.note && (
            <Card>
              <CardHeader>
                <CardTitle>Note from customer</CardTitle>
              </CardHeader>
              <CardContent className="whitespace-pre-wrap text-sm">{o.note}</CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function useOrderAction() {
  const queryClient = useQueryClient()
  return async (action: Promise<unknown>, success: string) => {
    try {
      await action
      await queryClient.invalidateQueries({ queryKey: orpc.admin.orders.key() })
      toast.success(success)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update order')
      return false
    }
  }
}

function OrderActions({ order }: { order: Order }) {
  const run = useOrderAction()
  const markAsPaid = useMutation(orpc.admin.orders.markAsPaid.mutationOptions())
  if (order.cancelledAt) return null

  const canPay = order.financialStatus === 'pending' || order.financialStatus === 'partially_paid'
  const canFulfill = order.fulfillmentStatus !== 'fulfilled'
  return (
    <>
      {order.fulfillmentStatus === 'unfulfilled' && <CancelButton order={order} />}
      {canPay && (
        <Button
          variant={canFulfill ? 'outline' : 'default'}
          disabled={markAsPaid.isPending}
          onClick={() => run(markAsPaid.mutateAsync({ id: order.id }), 'Order marked as paid')}
        >
          Mark as paid
        </Button>
      )}
      {canFulfill && <FulfillButton order={order} />}
    </>
  )
}

function FulfillButton({ order }: { order: Order }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const form = useZodForm(fulfillOrderInput, {
    defaultValues: { trackingCompany: '', trackingNumber: '', trackingUrl: '' },
  })
  const fulfill = useMutation(orpc.admin.orders.fulfill.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await fulfill.mutateAsync({ id: order.id, ...values })
      await queryClient.invalidateQueries({ queryKey: orpc.admin.orders.key() })
      toast.success('Order fulfilled')
      setOpen(false)
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
            Marks every item as shipped.
            {order.financialStatus === 'pending' ? ' The order is not paid yet.' : ''} Tracking is optional.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField control={form.control} name="trackingNumber" label="Tracking number" autoComplete="off" />
            <TextField
              control={form.control}
              name="trackingCompany"
              label="Shipping carrier"
              placeholder="DHL, UPS…"
              autoComplete="off"
            />
            <TextField control={form.control} name="trackingUrl" label="Tracking URL" type="url" autoComplete="off" />
            <FormError form={form} />
            <Field orientation="horizontal" className="justify-end">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Fulfilling…' : 'Fulfill items'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CancelButton({ order }: { order: Order }) {
  const run = useOrderAction()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<CancelReason>('customer')
  const [restock, setRestock] = useState(true)
  const cancel = useMutation(orpc.admin.orders.cancel.mutationOptions())
  const paid = order.financialStatus === 'paid' || order.financialStatus === 'partially_paid'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" />}>Cancel order</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {orderName(order.orderNumber)}?</DialogTitle>
          <DialogDescription>
            {!paid
              ? 'The pending payment is voided.'
              : (order.paymentGateway ?? 'manual') !== 'manual'
                ? `The payment is refunded through ${order.paymentMethodName ?? order.paymentGateway}.`
                : 'The payment is recorded as refunded. Send the money back to the customer the way they paid.'}{' '}
            This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="cancel-reason">Reason</FieldLabel>
            <select
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as CancelReason)}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              {CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {reasonLabel[r]}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
            Restock items
          </label>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Keep order</DialogClose>
          <Button
            variant="destructive"
            disabled={cancel.isPending}
            onClick={async () => {
              if (await run(cancel.mutateAsync({ id: order.id, reason, restock }), 'Order cancelled')) setOpen(false)
            }}
          >
            Cancel order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
