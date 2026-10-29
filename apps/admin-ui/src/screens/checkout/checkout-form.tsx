'use client'

import { Fragment, useRef, useState, type ComponentProps, type FormEvent } from 'react'
import { calculate, taxRateFor, type PricingDiscount, type PricingTaxRate } from '@shopnex/pricing/calculate'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { countryOptions } from '@/lib/countries'
import { formatMoney } from '@/lib/money'
import { placeOrder, quoteRates, type CheckoutFields, type PlaceOrderState } from './functions'

export type ShippingRateView = {
  id: string
  title: string
  priceCents: number
  freeAboveCents: number | null
  /** A carrier service's note, e.g. "2-5 days" */
  description?: string | null
}

export type CheckoutOptionsView = {
  /** The shop has carrier services: its live rates are asked for once the address is known */
  liveRates: boolean
  shippingRates: ShippingRateView[]
  paymentMethods: { id: string; name: string; additionalDetails: string | null; offsite: boolean }[]
}

export type TaxContextView = { taxesIncluded: boolean; taxShipping: boolean; taxRates: PricingTaxRate[] }

export function CheckoutForm({
  token,
  currency,
  lineTotals,
  discount,
  tax,
  options,
  defaultCountry,
}: {
  token: string
  currency: string
  /** Cart line totals (unit price × quantity) */
  lineTotals: number[]
  /** The cart's discount code, when it applies */
  discount: PricingDiscount | null
  tax: TaxContextView
  options: CheckoutOptionsView
  defaultCountry: string
}) {
  const [state, setState] = useState<PlaceOrderState>({})
  const [pending, setPending] = useState(false)
  const [rates, setRates] = useState(options.shippingRates)
  const [ratesPending, setRatesPending] = useState(false)
  // A quote for the address has come back (empty or not): no rates then means none for this address
  const [quoted, setQuoted] = useState(false)
  const [rateId, setRateId] = useState(state.values?.shippingRateId || options.shippingRates[0]?.id || '')
  const formRef = useRef<HTMLFormElement>(null)
  const latestQuote = useRef(0)
  const [methodId, setMethodId] = useState(state.values?.paymentMethodId || options.paymentMethods[0]?.id || '')
  // Tax follows the address as it's typed
  const [country, setCountry] = useState(state.values?.countryCode || defaultCountry)
  const [province, setProvince] = useState(state.values?.province ?? '')
  const money = (cents: number) => formatMoney(cents, currency)
  const method = options.paymentMethods.find((m) => m.id === methodId)
  // Same math the server uses when the order is placed
  const totals = calculate({
    lines: lineTotals,
    shippingCents: rates.find((r) => r.id === rateId)?.priceCents ?? 0,
    discount,
    taxRate: taxRateFor(tax.taxRates, { countryCode: country, province }),
    taxesIncluded: tax.taxesIncluded,
    taxShipping: tax.taxShipping,
  })

  // Carrier services quote for the address, so ask again when it changes (flat rates come back unchanged).
  // Only the newest answer counts: the buyer may keep typing.
  async function refreshRates() {
    const form = formRef.current
    if (!options.liveRates || !form) return
    const data = new FormData(form)
    const text = (name: string) => String(data.get(name) ?? '').trim() || undefined
    const countryCode = text('countryCode')
    if (!countryCode || !text('address1') || !text('city')) return
    const quote = ++latestQuote.current
    setRatesPending(true)
    try {
      const next = await quoteRates({
        data: {
          token,
          address: {
            countryCode,
            province: text('province'),
            city: text('city'),
            zip: text('zip'),
            address1: text('address1'),
          },
        },
      })
      if (quote !== latestQuote.current || !next) return
      setRates(next)
      setQuoted(true)
      // Keep the buyer's choice while it is still offered
      setRateId((current) => (next.some((r) => r.id === current) ? current : (next[0]?.id ?? '')))
    } catch {
      // The shipping methods already shown stay: the order is checked again when it is placed
    } finally {
      if (quote === latestQuote.current) setRatesPending(false)
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as CheckoutFields
      const result = await placeOrder({ data: { token, values } })
      if (result.redirectTo) window.location.assign(result.redirectTo)
      else setState(result)
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : 'Could not place the order.' })
    } finally {
      setPending(false)
    }
  }

  // Uncontrolled inputs keep what was typed when the action returns an error (values are echoed back)
  const field = (name: string, label: string, props: ComponentProps<typeof Input> = {}) => {
    const error = state.fieldErrors?.[name]
    return (
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={name}>{label}</FieldLabel>
        <Input
          id={name}
          name={name}
          defaultValue={state.values?.[name]}
          aria-invalid={error ? true : undefined}
          {...props}
        />
        {error && <FieldError>{error}</FieldError>}
      </Field>
    )
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      onBlurCapture={(e) => {
        if (['address1', 'city', 'zip', 'province'].includes((e.target as unknown as { name?: string }).name ?? ''))
          void refreshRates()
      }}
      noValidate
      className="space-y-8"
    >
      <FieldSet>
        <FieldLegend>Contact</FieldLegend>
        <FieldGroup>{field('email', 'Email', { type: 'email', autoComplete: 'email', required: true })}</FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Shipping address</FieldLegend>
        <FieldGroup>
          <Field data-invalid={state.fieldErrors?.countryCode ? true : undefined}>
            <FieldLabel htmlFor="countryCode">Country / region</FieldLabel>
            <select
              id="countryCode"
              name="countryCode"
              autoComplete="country"
              defaultValue={state.values?.countryCode || defaultCountry}
              onChange={(e) => {
                setCountry(e.target.value)
                void refreshRates()
              }}
              className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
            >
              {countryOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            {state.fieldErrors?.countryCode && <FieldError>{state.fieldErrors.countryCode}</FieldError>}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {field('firstName', 'First name (optional)', { autoComplete: 'given-name' })}
            {field('lastName', 'Last name', { autoComplete: 'family-name', required: true })}
          </div>
          {field('company', 'Company (optional)', { autoComplete: 'organization' })}
          {field('address1', 'Address', { autoComplete: 'address-line1', required: true })}
          {field('address2', 'Apartment, suite, etc. (optional)', { autoComplete: 'address-line2' })}
          <div className="grid gap-4 sm:grid-cols-3">
            {field('zip', 'Postal code', { autoComplete: 'postal-code' })}
            {field('city', 'City', { autoComplete: 'address-level2', required: true })}
            {field('province', 'State / region', {
              autoComplete: 'address-level1',
              onChange: (e) => setProvince(e.target.value),
            })}
          </div>
          {field('phone', 'Phone (optional)', { type: 'tel', autoComplete: 'tel' })}
        </FieldGroup>
      </FieldSet>

      {(rates.length > 0 || options.liveRates) && (
        <FieldSet>
          <FieldLegend>Shipping method</FieldLegend>
          {rates.length === 0 && (
            <FieldDescription>
              {ratesPending
                ? 'Getting shipping rates…'
                : quoted
                  ? "We can't ship to this address. Check it, or try another one."
                  : 'Enter your address to see shipping methods.'}
            </FieldDescription>
          )}
          <Choices
            name="shippingRateId"
            value={rateId}
            onChange={setRateId}
            choices={rates.map((r) => ({
              id: r.id,
              label: r.title,
              aside: r.priceCents === 0 ? 'Free' : money(r.priceCents),
              hint:
                r.freeAboveCents != null && r.priceCents > 0
                  ? `Free on orders from ${money(r.freeAboveCents)}`
                  : (r.description ?? undefined),
            }))}
          />
        </FieldSet>
      )}

      <FieldSet>
        <FieldLegend>Payment</FieldLegend>
        <FieldDescription>
          {method?.offsite
            ? "You'll pay securely on the next page."
            : "You'll get payment instructions after placing the order."}
        </FieldDescription>
        <Choices
          name="paymentMethodId"
          value={methodId}
          onChange={setMethodId}
          choices={options.paymentMethods.map((m) => ({ id: m.id, label: m.name }))}
        />
        {method?.additionalDetails && (
          <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm text-muted-foreground">
            {method.additionalDetails}
          </p>
        )}
        {state.fieldErrors?.paymentMethodId && <FieldError>{state.fieldErrors.paymentMethodId}</FieldError>}
      </FieldSet>

      <Field>
        <FieldLabel htmlFor="note">Order note (optional)</FieldLabel>
        <Textarea id="note" name="note" rows={2} defaultValue={state.values?.note} />
      </Field>

      <div className="space-y-3 border-t pt-6">
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm tabular-nums">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="text-right">{money(totals.subtotalCents)}</dd>
          {totals.discountCents > 0 && (
            <>
              <dt className="text-muted-foreground">Discount · {discount!.code}</dt>
              <dd className="text-right">−{money(totals.discountCents)}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Shipping</dt>
          <dd className="text-right">{totals.shippingCents === 0 ? 'Free' : money(totals.shippingCents)}</dd>
          {!totals.taxesIncluded &&
            totals.taxLines.map((t) => (
              <Fragment key={t.title}>
                <dt className="text-muted-foreground">
                  {t.title} {t.ratePercent}%
                </dt>
                <dd className="text-right">{money(t.amountCents)}</dd>
              </Fragment>
            ))}
          <dt className="text-base font-semibold">Total</dt>
          <dd className="text-right text-base font-semibold">{money(totals.totalCents)}</dd>
          {totals.taxesIncluded &&
            totals.taxLines.map((t) => (
              <dd key={t.title} className="col-span-2 text-right text-muted-foreground">
                Including {money(t.amountCents)} {t.title}
              </dd>
            ))}
        </dl>
        {state.error && <FieldError>{state.error}</FieldError>}
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? 'Placing order…' : method?.offsite ? 'Continue to payment' : 'Place order'}
        </Button>
      </div>
    </form>
  )
}

// Radio list styled as selectable rows
function Choices({
  name,
  value,
  onChange,
  choices,
}: {
  name: string
  value: string
  onChange: (id: string) => void
  choices: { id: string; label: string; aside?: string; hint?: string }[]
}) {
  return (
    <div className="divide-y rounded-lg border">
      {choices.map((c) => (
        <label key={c.id} className="flex cursor-pointer items-center gap-3 p-3 text-sm has-checked:bg-muted/60">
          <input
            type="radio"
            name={name}
            value={c.id}
            checked={value === c.id}
            onChange={() => onChange(c.id)}
            className="size-4 accent-primary"
          />
          <span className="flex-1">
            {c.label}
            {c.hint && <span className="block text-xs text-muted-foreground">{c.hint}</span>}
          </span>
          {c.aside && <span className="tabular-nums">{c.aside}</span>}
        </label>
      ))}
    </div>
  )
}
