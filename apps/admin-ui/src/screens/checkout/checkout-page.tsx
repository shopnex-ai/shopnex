// Hosted checkout: any storefront (Next, Astro, …) creates a cart through the Storefront API and redirects
// here. Buyer gives contact + shipping address, picks a shipping rate and a payment method; after placing
// the order the same URL shows the confirmation (with payment instructions for manual methods).
import { Fragment, type ReactNode } from 'react'
import { AddressLines } from '@/components/admin/address'
import { Button } from '@/components/ui/button'
import { orderName } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import type { getCheckout } from './functions'
import type { CheckoutBranding } from './branding'
import { CheckoutForm } from './checkout-form'
import { DiscountCodeForm } from './discount-code-form'
import { OffsitePayment } from './offsite-payment'

export type CheckoutView = Exclude<Awaited<ReturnType<typeof getCheckout>>, null>

export function CheckoutPage({ data }: { data: CheckoutView }) {
  if (data.kind === 'confirmation')
    return (
      <Confirmation
        token={data.token}
        shopName={data.shopName}
        storefrontUrl={data.storefrontUrl}
        branding={data.branding}
        order={data.order}
        payment={data.payment}
      />
    )
  const { cart, options, tax } = data
  const money = (cents: number) => formatMoney(cents, cart.currency)
  const unavailable = cart.lines.some((l) => !l.available)

  return (
    <Shell shopName={data.shopName} storefrontUrl={data.storefrontUrl} branding={data.branding}>
      <div className="grid gap-10 md:grid-cols-[1fr_380px] md:items-start">
        <section className="order-2 md:order-1">
          {cart.lines.length === 0 ? (
            <p className="text-muted-foreground">Your cart is empty.</p>
          ) : unavailable ? (
            <p className="text-muted-foreground">Some items are out of stock. Update your cart to continue.</p>
          ) : cart.discountCode && !cart.discountCode.applicable ? (
            <p className="text-muted-foreground">Remove the discount code that no longer applies to continue.</p>
          ) : options.paymentMethods.length === 0 ? (
            <p className="text-muted-foreground">This store isn&apos;t accepting orders yet. Please check back soon.</p>
          ) : (
            <CheckoutForm
              token={cart.token}
              currency={cart.currency}
              lineTotals={cart.lines.map((l) => l.lineTotalCents)}
              discount={cart.discount}
              tax={tax}
              options={options}
              defaultCountry={data.defaultCountry}
              countries={data.countries}
            />
          )}
        </section>

        <aside className="order-1 rounded-lg border bg-muted/30 p-4 md:order-2 md:sticky md:top-6">
          <h2 className="mb-3 font-medium">Order summary</h2>
          <LineList
            lines={cart.lines.map((l) => ({
              key: l.lineId,
              title: l.title,
              detail: l.isDefaultVariant ? null : l.variantTitle,
              imageUrl: l.imageUrl,
              quantity: l.quantity,
              total: money(l.lineTotalCents),
              warning: l.available ? null : 'Not enough stock',
            }))}
          />
          {cart.lines.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <DiscountCodeForm token={cart.token} current={cart.discountCode} />
            </div>
          )}
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 border-t pt-3 text-sm tabular-nums">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right">{money(cart.subtotalCents)}</dd>
            {cart.discountCents > 0 && (
              <>
                <dt className="text-muted-foreground">Discount · {cart.discountCode!.code}</dt>
                <dd className="text-right">−{money(cart.discountCents)}</dd>
              </>
            )}
          </dl>
        </aside>
      </div>
    </Shell>
  )
}

type Confirmed = Extract<CheckoutView, { kind: 'confirmation' }>
type Order = Confirmed['order']

function Confirmation({
  token,
  shopName,
  storefrontUrl,
  branding,
  order,
  payment,
}: {
  token: string
  shopName: string
  storefrontUrl: string | null
  branding: CheckoutBranding | null
  order: Order
  payment: Confirmed['payment']
}) {
  const money = (cents: number) => formatMoney(cents, order.currency)
  const awaitingPayment = order.financialStatus === 'pending' && !order.cancelledAt
  // Paid through a payments app (card…) rather than outside Shopnex
  const offsite = (order.paymentGateway ?? 'manual') !== 'manual'
  const firstName = order.shippingAddress?.firstName
  return (
    <Shell shopName={shopName} storefrontUrl={storefrontUrl} branding={branding}>
      <div className="mx-auto max-w-xl space-y-6">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Order {orderName(order.orderNumber)}</p>
          <h1 className="text-2xl font-semibold">
            {awaitingPayment && offsite ? 'Complete your payment' : `Thank you${firstName ? `, ${firstName}` : ''}!`}
          </h1>
          <p className="text-muted-foreground">
            {order.cancelledAt
              ? offsite && payment && payment.status !== 'resolved'
                ? "This order was cancelled because payment wasn't completed."
                : 'This order was cancelled.'
              : awaitingPayment && offsite
                ? `Your order is reserved and ships once payment is received. Total due: ${money(order.totalCents)}.`
                : `Your order is confirmed. We'll send updates to ${order.email}.`}
          </p>
        </div>

        {awaitingPayment && offsite && (
          <OffsitePayment token={token} methodName={order.paymentMethodName} status={payment?.status ?? null} />
        )}

        {awaitingPayment && !offsite && (
          <section className="space-y-2 rounded-lg border p-4">
            <h2 className="font-medium">Payment{order.paymentMethodName ? `: ${order.paymentMethodName}` : ''}</h2>
            <p className="whitespace-pre-wrap text-sm">
              {order.paymentInstructions ||
                `The shop will contact you about payment. Total due: ${money(order.totalCents)}.`}
            </p>
            <p className="text-sm text-muted-foreground">
              Use {orderName(order.orderNumber)} as the payment reference. Your order ships once payment is received.
            </p>
          </section>
        )}

        <section className="rounded-lg border p-4">
          <LineList
            lines={order.items.map((i) => ({
              key: i.id,
              title: i.title,
              detail: i.variantTitle,
              imageUrl: i.imageUrl,
              quantity: i.quantity,
              total: money(i.unitPriceCents * i.quantity),
            }))}
          />
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 border-t pt-3 text-sm tabular-nums">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right">{money(order.subtotalCents)}</dd>
            {order.discountCents > 0 && (
              <>
                <dt className="text-muted-foreground">
                  Discount{order.discountCodes.length ? ` · ${order.discountCodes.join(', ')}` : ''}
                </dt>
                <dd className="text-right">−{money(order.discountCents)}</dd>
              </>
            )}
            <dt className="text-muted-foreground">
              Shipping{order.shippingLines[0] ? ` · ${order.shippingLines[0].title}` : ''}
            </dt>
            <dd className="text-right">{order.shippingCents === 0 ? 'Free' : money(order.shippingCents)}</dd>
            {!order.taxesIncluded &&
              order.taxLines.map((t) => (
                <Fragment key={t.title}>
                  <dt className="text-muted-foreground">
                    {t.title} {t.ratePercent}%
                  </dt>
                  <dd className="text-right">{money(t.amountCents)}</dd>
                </Fragment>
              ))}
            <dt className="font-semibold">Total</dt>
            <dd className="text-right font-semibold">{money(order.totalCents)}</dd>
            {order.taxesIncluded &&
              order.taxLines.map((t) => (
                <dd key={t.title} className="col-span-2 text-right text-muted-foreground">
                  Including {money(t.amountCents)} {t.title}
                </dd>
              ))}
          </dl>
        </section>

        {order.shippingAddress && (
          <section className="space-y-2">
            <h2 className="font-medium">Shipping to</h2>
            <AddressLines address={order.shippingAddress} />
          </section>
        )}

        {storefrontUrl && (
          <Button size="lg" render={<a href={storefrontUrl} />}>
            Continue shopping
          </Button>
        )}
      </div>
    </Shell>
  )
}

function Shell({
  shopName,
  storefrontUrl,
  branding,
  children,
}: {
  shopName: string
  storefrontUrl: string | null
  branding: CheckoutBranding | null
  children: ReactNode
}) {
  const name = branding?.logoUrl ? (
    <img src={branding.logoUrl} alt={shopName} className="h-8 w-auto max-w-48 object-contain" />
  ) : (
    <span className="text-lg font-semibold">{shopName}</span>
  )
  return (
    // The theme's colors win over light/dark mode: set inline, they sit closer than the .dark variables
    <div
      className="min-h-svh bg-background text-foreground"
      style={branding?.style}
      data-themed={branding ? '' : undefined}
    >
      {branding?.fontsHref && <link rel="stylesheet" href={branding.fontsHref} />}
      {branding?.headingFont && (
        <style>{`[data-themed] :is(h1,h2,h3){font-family:'${branding.headingFont}',system-ui,sans-serif}`}</style>
      )}
      <header className="border-b">
        <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
          {storefrontUrl ? <a href={storefrontUrl}>{name}</a> : name}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}

function LineList({
  lines,
}: {
  lines: {
    key: string
    title: string
    detail: string | null
    imageUrl: string | null
    quantity: number
    total: string
    warning?: string | null
  }[]
}) {
  return (
    <ul className="space-y-3">
      {lines.map((l) => (
        <li key={l.key} className="flex items-center gap-3">
          <div className="relative">
            <div
              className="size-14 shrink-0 rounded-md border bg-muted bg-cover bg-center"
              style={l.imageUrl ? { backgroundImage: `url(${JSON.stringify(l.imageUrl)})` } : undefined}
            />
            <span className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-foreground text-[11px] text-background tabular-nums">
              {l.quantity}
            </span>
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">{l.title}</div>
            {l.detail && <div className="text-muted-foreground">{l.detail}</div>}
            {l.warning && <div className="text-destructive">{l.warning}</div>}
          </div>
          <div className="text-sm tabular-nums">{l.total}</div>
        </li>
      ))}
    </ul>
  )
}
