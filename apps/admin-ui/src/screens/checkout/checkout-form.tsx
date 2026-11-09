'use client'

import { PlusIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { useController, useWatch } from 'react-hook-form'
import { FormError, REQUIRED_MARK, TextareaField, TextField, useZodForm } from '@/components/admin/form'
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
import { formatMoney } from '@/lib/money'
import { buyer, postalCodeRequired, regionRequired } from './buyer-schema'
import { placeOrder, quoteRates, saveReminderContact, type CheckoutFields } from './functions'
import { useCheckoutTotals } from './totals'

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

export function CheckoutForm({
  token,
  currency,
  options,
  defaultCountry,
  countries,
  offerReminder,
}: {
  token: string
  currency: string
  /** The shop sends abandoned cart emails: show the checkbox that asks for one */
  offerReminder: boolean
  options: CheckoutOptionsView
  defaultCountry: string
  countries: { value: string; label: string }[]
}) {
  // The server's schema, so the browser rejects exactly what `placeOrder` would. Values stay the raw strings typed
  const form = useZodForm(buyer, {
    mode: 'onTouched',
    defaultValues: {
      email: '',
      firstName: '',
      lastName: '',
      company: '',
      address1: '',
      address2: '',
      city: '',
      province: '',
      countryCode: defaultCountry,
      zip: '',
      phone: '',
      shippingRateId: options.shippingRates[0]?.id ?? '',
      paymentMethodId: options.paymentMethods[0]?.id ?? '',
      note: '',
    },
  })
  const { control, formState } = form
  const [rates, setRates] = useState(options.shippingRates)
  const [ratesPending, setRatesPending] = useState(false)
  // A quote for the address has come back (empty or not): no rates then means none for this address
  const [quoted, setQuoted] = useState(false)
  const latestQuote = useRef(0)
  // Optional fields stay behind a link until the buyer wants them, and appear in the order they are opened
  const [opened, setOpened] = useState<string[]>([])
  const [rateId = '', methodId = '', country = defaultCountry, province = ''] = useWatch({
    control,
    name: ['shippingRateId', 'paymentMethodId', 'countryCode', 'province'],
  })
  // Tax follows the address as it's typed, and the order summary beside the form follows the totals
  const { setCountry, setProvince, setShippingCents } = useCheckoutTotals()
  useEffect(() => setCountry(country), [country, setCountry])
  useEffect(() => setProvince(province), [province, setProvince])
  const money = (cents: number) => formatMoney(cents, currency)
  const method = options.paymentMethods.find((m) => m.id === methodId)
  const shippingCents = rates.find((r) => r.id === rateId)?.priceCents ?? (options.liveRates ? null : 0)
  useEffect(() => setShippingCents(shippingCents), [shippingCents, setShippingCents])
  const countryField = useController({ control, name: 'countryCode' })
  const setRateId = (id: string) => form.setValue('shippingRateId', id)
  const setMethodId = (id: string) => form.setValue('paymentMethodId', id)

  // Carrier services quote for the address, so ask again when it changes (flat rates come back unchanged).
  // Only the newest answer counts: the buyer may keep typing.
  async function refreshRates() {
    if (!options.liveRates) return
    const values = form.getValues()
    const text = (value: string | undefined) => value?.trim() || undefined
    const countryCode = text(values.countryCode)
    if (!countryCode || !text(values.address1) || !text(values.city)) return
    const quote = ++latestQuote.current
    setRatesPending(true)
    try {
      const next = await quoteRates({
        data: {
          token,
          address: {
            countryCode,
            province: text(values.province),
            city: text(values.city),
            zip: text(values.zip),
            address1: text(values.address1),
          },
        },
      })
      if (quote !== latestQuote.current || !next) return
      setRates(next)
      setQuoted(true)
      // Keep the buyer's choice while it is still offered
      if (!next.some((r) => r.id === form.getValues('shippingRateId'))) setRateId(next[0]?.id ?? '')
    } catch {
      // The shipping methods already shown stay: the order is checked again when it is placed
    } finally {
      if (quote === latestQuote.current) setRatesPending(false)
    }
  }

  // The email is kept with the cart when the shop sends cart reminders (the hint under the field says so)
  function saveContact() {
    if (!offerReminder) return
    const email = form.getValues('email').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return
    void saveReminderContact({ data: { token, email } }).catch(() => {
      // A reminder is a nicety: never get in the way of the order
    })
  }

  // Shipping is offered but none chosen (carriers still waiting for an address): the schema can't know
  const needsRate = rates.length > 0 || options.liveRates
  const onSubmit = form.handleSubmit(async () => {
    if (needsRate && !form.getValues('shippingRateId')) {
      form.setError('root', {
        message: ratesPending
          ? 'Still getting shipping rates, try again in a moment.'
          : rates.length === 0 && quoted
            ? "We can't ship to this address. Check it, or try another one."
            : 'Enter your address to choose a shipping method.',
      })
      return
    }
    try {
      // The raw strings: the server parses them with the same schema
      const result = await placeOrder({ data: { token, values: form.getValues() as CheckoutFields } })
      if (result.redirectTo) {
        window.location.assign(result.redirectTo)
        return
      }
      // Refused by the server: its messages go on the fields they belong to
      for (const [name, message] of Object.entries(result.fieldErrors ?? {}))
        form.setError(name as keyof typeof buyer.shape, { message })
      form.setError('root', { message: result.error ?? 'Could not place the order.' })
    } catch (error) {
      form.setError('root', { message: error instanceof Error ? error.message : 'Could not place the order.' })
    }
  })

  const isOpen = (name: string) => opened.includes(name)
  const optionalFields = (items: OptionalField[]) =>
    opened.map((name) => {
      const item = items.find((i) => i.name === name)
      return (
        item && <TextField key={name} control={control} name={item.name} label={item.label} autoFocus {...item.props} />
      )
    })
  const addLinks = (items: { name: string; label: string }[]) => {
    const closed = items.filter((i) => !isOpen(i.name))
    if (closed.length === 0) return null
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {closed.map((i) => (
          <AddLink key={i.name} label={i.label} onClick={() => setOpened((o) => [...o, i.name])} />
        ))}
      </div>
    )
  }

  const label = formState.isSubmitting ? 'Placing order…' : method?.offsite ? 'Continue to payment' : 'Place order'

  const optionalAddressFields: OptionalField[] = [
    { name: 'address2', label: 'Apartment, suite, etc.', props: { autoComplete: 'address-line2' } },
    { name: 'company', label: 'Company', props: { autoComplete: 'organization' } },
    { name: 'phone', label: 'Phone', props: { type: 'tel', autoComplete: 'tel' } },
  ]

  return (
    <form
      onSubmit={onSubmit}
      onBlurCapture={(e) => {
        const name = (e.target as unknown as { name?: string }).name ?? ''
        if (['address1', 'city', 'zip', 'province'].includes(name)) void refreshRates()
        if (name === 'email') saveContact()
      }}
      noValidate
      className="space-y-8"
    >
      <FieldSet>
        <FieldLegend>Contact</FieldLegend>
        <FieldGroup>
          <TextField
            control={control}
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            hint={offerReminder ? 'Used for your order confirmation and cart reminders' : undefined}
          />
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Shipping address</FieldLegend>
        <FieldGroup>
          <Field data-invalid={countryField.fieldState.error ? true : undefined}>
            <FieldLabel htmlFor="countryCode" className={REQUIRED_MARK}>
              Country / region
            </FieldLabel>
            <select
              id="countryCode"
              name={countryField.field.name}
              ref={countryField.field.ref}
              value={countryField.field.value}
              autoComplete="country"
              onBlur={countryField.field.onBlur}
              onChange={(e) => {
                countryField.field.onChange(e.target.value)
                // What was typed for the old country may not fit the new one
                for (const name of ['zip', 'province'] as const) if (form.getValues(name)) void form.trigger(name)
                void refreshRates()
              }}
              className="h-9 w-full rounded-md border bg-background px-2.5 text-sm"
            >
              {countries.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <FieldError errors={[countryField.fieldState.error]} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField control={control} name="firstName" label="First name" autoComplete="given-name" />
            <TextField control={control} name="lastName" label="Last name" autoComplete="family-name" required />
          </div>
          <TextField control={control} name="address1" label="Address" autoComplete="address-line1" required />
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              control={control}
              name="zip"
              label="Postal code"
              required={postalCodeRequired(country)}
              autoComplete="postal-code"
            />
            <TextField control={control} name="city" label="City" autoComplete="address-level2" required />
            <TextField
              control={control}
              name="province"
              label="State / region"
              required={regionRequired(country)}
              autoComplete="address-level1"
            />
          </div>
          {optionalFields(optionalAddressFields)}
          {addLinks(optionalAddressFields)}
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
        <FieldError errors={[formState.errors.paymentMethodId]} />
      </FieldSet>

      {isOpen('note') ? (
        <TextareaField control={control} name="note" label="Order note" rows={2} autoFocus />
      ) : (
        addLinks([{ name: 'note', label: 'Order note' }])
      )}

      <div className="space-y-3">
        <FormError form={form} />
        <Button
          data-ph-capture="place-order"
          type="submit"
          size="lg"
          className="w-full"
          disabled={formState.isSubmitting}
        >
          {label}
        </Button>
      </div>
    </form>
  )
}

type OptionalField = {
  name: 'address2' | 'company' | 'phone'
  label: string
  props?: Pick<ComponentProps<'input'>, 'type' | 'autoComplete'>
}

function AddLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <PlusIcon className="size-3.5" />
      {label}
    </button>
  )
}

// Radio list styled as selectable rows. A lone choice is just shown: nothing to pick.
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
  const single = choices.length === 1
  return (
    <div className="divide-y rounded-lg border">
      {choices.map((c) => (
        <label
          key={c.id}
          className={`flex items-center gap-3 p-3 text-sm has-checked:bg-muted/60 ${single ? '' : 'cursor-pointer'}`}
        >
          {!single && (
            <input
              type="radio"
              name={name}
              value={c.id}
              checked={value === c.id}
              onChange={() => onChange(c.id)}
              className="size-4 accent-primary"
            />
          )}
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
