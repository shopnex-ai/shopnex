'use client'

// The order summary (beside the form) and the form share one set of totals: they follow the address
// and the shipping method as the buyer picks them, with the same math the server uses at placement.
import { Fragment, createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { calculate, taxRateFor, type PricingDiscount, type PricingTaxRate } from '@shopnex/pricing/calculate'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { formatMoney } from '@/lib/money'

export type TaxContextView = { taxesIncluded: boolean; taxShipping: boolean; taxRates: PricingTaxRate[] }

type Totals = ReturnType<typeof calculate>

/** What the "place order" button shows: the form owns it, the summary beside it renders the same button too */
export type PlaceOrderAction = { label: string; disabled: boolean; error?: string }

type TotalsContextValue = {
  totals: Totals
  currency: string
  discountCode: string | null
  /** No shipping price yet: carrier rates wait for the address */
  shippingUnknown: boolean
  country: string
  setCountry: (value: string) => void
  setProvince: (value: string) => void
  /** null while no shipping method is available */
  setShippingCents: (value: number | null) => void
  action: PlaceOrderAction | null
  setAction: (value: PlaceOrderAction | null) => void
}

const TotalsContext = createContext<TotalsContextValue | null>(null)

export function useCheckoutTotals() {
  const value = useContext(TotalsContext)
  if (!value) throw new Error('useCheckoutTotals must be used inside <TotalsProvider>')
  return value
}

export function TotalsProvider({
  currency,
  lineTotals,
  discount,
  tax,
  defaultCountry,
  initialShippingCents,
  children,
}: {
  currency: string
  /** Cart line totals (unit price × quantity) */
  lineTotals: number[]
  /** The cart's discount code, when it applies */
  discount: PricingDiscount | null
  tax: TaxContextView
  defaultCountry: string
  /** The preselected shipping method's price; null when the shop asks carriers once the address is known */
  initialShippingCents: number | null
  children: ReactNode
}) {
  const [country, setCountry] = useState(defaultCountry)
  const [province, setProvince] = useState('')
  const [shippingCents, setShippingCents] = useState<number | null>(initialShippingCents)
  const [action, setAction] = useState<PlaceOrderAction | null>(null)
  const value = useMemo<TotalsContextValue>(
    () => ({
      totals: calculate({
        lines: lineTotals,
        shippingCents: shippingCents ?? 0,
        discount,
        taxRate: taxRateFor(tax.taxRates, { countryCode: country, province }),
        taxesIncluded: tax.taxesIncluded,
        taxShipping: tax.taxShipping,
      }),
      currency,
      discountCode: discount?.code ?? null,
      shippingUnknown: shippingCents === null,
      country,
      setCountry,
      setProvince,
      setShippingCents,
      action,
      setAction,
    }),
    [lineTotals, shippingCents, discount, tax, country, province, currency, action],
  )
  return <TotalsContext.Provider value={value}>{children}</TotalsContext.Provider>
}

/** Subtotal → total, with whatever shipping and tax are known so far */
export function TotalsBreakdown() {
  const { totals, currency, discountCode, shippingUnknown } = useCheckoutTotals()
  const money = (cents: number) => formatMoney(cents, currency)
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm tabular-nums">
      <dt className="text-muted-foreground">Subtotal</dt>
      <dd className="text-right">{money(totals.subtotalCents)}</dd>
      {totals.discountCents > 0 && (
        <>
          <dt className="text-muted-foreground">Discount · {discountCode}</dt>
          <dd className="text-right">−{money(totals.discountCents)}</dd>
        </>
      )}
      <dt className="text-muted-foreground">Shipping</dt>
      <dd className={shippingUnknown ? 'text-right text-muted-foreground' : 'text-right'}>
        {shippingUnknown ? 'Enter address' : totals.shippingCents === 0 ? 'Free' : money(totals.shippingCents)}
      </dd>
      {!totals.taxesIncluded &&
        totals.taxLines.map((t) => (
          <Fragment key={t.title}>
            <dt className="text-muted-foreground">
              {t.title} {t.ratePercent}%
            </dt>
            <dd className="text-right">{money(t.amountCents)}</dd>
          </Fragment>
        ))}
      <dt className="border-t pt-2 text-base font-semibold">Total</dt>
      <dd className="border-t pt-2 text-right text-base font-semibold">{money(totals.totalCents)}</dd>
      {totals.taxesIncluded &&
        totals.taxLines.map((t) => (
          <dd key={t.title} className="col-span-2 text-right text-muted-foreground">
            Including {money(t.amountCents)} {t.title}
          </dd>
        ))}
    </dl>
  )
}

/** Submits the checkout form from anywhere on the page (the form has id="checkout-form") */
export function PlaceOrderButton() {
  const { action } = useCheckoutTotals()
  if (!action) return null
  return (
    <div className="space-y-2">
      {action.error && <FieldError>{action.error}</FieldError>}
      <Button
        data-ph-capture="place-order"
        type="submit"
        form="checkout-form"
        size="lg"
        className="w-full"
        disabled={action.disabled}
      >
        {action.label}
      </Button>
    </div>
  )
}
