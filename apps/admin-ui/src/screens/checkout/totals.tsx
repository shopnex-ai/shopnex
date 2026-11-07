'use client'

// The order summary (beside the form) and the form share one set of totals: they follow the address
// and the shipping method as the buyer picks them, with the same math the server uses at placement.
import { Fragment, createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { calculate, taxRateFor, type PricingDiscount, type PricingTaxRate } from '@shopnex/pricing/calculate'
import { formatMoney } from '@/lib/money'

export type TaxContextView = { taxesIncluded: boolean; taxShipping: boolean; taxRates: PricingTaxRate[] }

type Totals = ReturnType<typeof calculate>

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
    }),
    [lineTotals, shippingCents, discount, tax, country, province, currency],
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
