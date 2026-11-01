'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { paymentMethodInput, shippingRateInput, shopInput } from '@shopnex/api/schemas'
import {
  FormError,
  MoneyField,
  SelectField,
  TextField,
  TextareaField,
  setServerError,
  useZodForm,
} from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { clearAdminContext } from '@/lib/admin-context'
import { currencyOptions } from '@/lib/currency'
import { orpc } from '@/lib/orpc'

const STEPS = ['Shop', 'Payments', 'Shipping'] as const
type Step = 0 | 1 | 2

// Shown once, right after the owner account is created. Everything here lives in Settings too, so each
// step after the first can be skipped and the wizard is never needed again.
export function WelcomeWizard() {
  const navigate = useNavigate()
  const router = useRouter()
  const { data: shop, error } = useQuery(orpc.admin.shop.get.queryOptions())
  const [step, setStep] = useState<Step>(0)
  const [currency, setCurrency] = useState<string | null>(null)

  async function finish() {
    // The sidebar and header show the shop name (server-rendered)
    clearAdminContext(router)
    await navigate({ to: '/admin', replace: true })
    await router.invalidate()
  }
  const next = () => (step === 2 ? finish() : setStep((step + 1) as Step))

  return (
    <Card>
      <CardHeader>
        <p className="text-xs font-medium text-muted-foreground">
          Step {step + 1} of {STEPS.length} · {STEPS[step]}
        </p>
        {step === 0 && (
          <>
            <CardTitle>Name your shop</CardTitle>
            <CardDescription>Shown to customers on your storefront and at checkout.</CardDescription>
          </>
        )}
        {step === 1 && (
          <>
            <CardTitle>How will customers pay?</CardTitle>
            <CardDescription>
              Add a manual method such as bank transfer or cash on delivery. Card payments with Stripe are connected
              from Settings → Payments.
            </CardDescription>
          </>
        )}
        {step === 2 && (
          <>
            <CardTitle>How will you ship?</CardTitle>
            <CardDescription>
              One rate for every address. Without one, checkout charges no shipping. You can add more in Settings.
            </CardDescription>
          </>
        )}
      </CardHeader>
      <CardContent>
        {step === 0 &&
          (shop ? (
            <ShopStep
              name={shop.name}
              currency={shop.currency}
              onDone={(saved) => {
                setCurrency(saved)
                next()
              }}
            />
          ) : error ? (
            <p className="text-sm text-destructive">{error.message}</p>
          ) : (
            <Skeleton className="h-40 w-full" />
          ))}
        {step === 1 && <PaymentStep onDone={next} />}
        {step === 2 && <ShippingStep currency={currency ?? shop?.currency ?? 'USD'} onDone={next} />}
      </CardContent>
    </Card>
  )
}

const shopStepInput = shopInput.pick({ name: true, currency: true }).required()

function ShopStep({ name, currency, onDone }: { name: string; currency: string; onDone: (currency: string) => void }) {
  const form = useZodForm(shopStepInput, { defaultValues: { name, currency } })
  const update = useMutation(orpc.admin.shop.update.mutationOptions())
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync(values)
      onDone(saved.currency)
    } catch (error) {
      setServerError(form, error)
    }
  })
  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <TextField control={form.control} name="name" label="Shop name" autoComplete="off" autoFocus />
        <SelectField
          control={form.control}
          name="currency"
          label="Currency"
          description="Prices are stored in this currency."
          options={currencyOptions}
        />
        <FormError form={form} />
        <Field orientation="horizontal" className="justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Saving…' : 'Continue'}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}

function PaymentStep({ onDone }: { onDone: () => void }) {
  const form = useZodForm(paymentMethodInput, {
    defaultValues: { name: 'Bank transfer', additionalDetails: null, instructions: null, active: true },
  })
  const create = useMutation(orpc.admin.paymentMethods.create.mutationOptions())
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync(values)
      onDone()
    } catch (error) {
      setServerError(form, error)
    }
  })
  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <TextField control={form.control} name="name" label="Name" placeholder="Bank transfer" autoComplete="off" />
        <TextareaField
          control={form.control}
          name="instructions"
          label="Payment instructions"
          nullable
          rows={4}
          placeholder={'IBAN: …\nUse your order number as the reference.'}
          description="Shown after the order is placed, so the buyer knows how to pay."
        />
        <FormError form={form} />
        <Field orientation="horizontal" className="justify-between">
          <Button type="button" variant="ghost" onClick={onDone}>
            Skip for now
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Saving…' : 'Add and continue'}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}

function ShippingStep({ currency, onDone }: { currency: string; onDone: () => void }) {
  const form = useZodForm(shippingRateInput, {
    defaultValues: { name: 'Standard shipping', priceCents: 0, freeAboveCents: null, active: true },
  })
  const create = useMutation(orpc.admin.shippingRates.create.mutationOptions())
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync(values)
      onDone()
    } catch (error) {
      setServerError(form, error)
    }
  })
  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <TextField control={form.control} name="name" label="Name" placeholder="Standard shipping" autoComplete="off" />
        <MoneyField
          control={form.control}
          name="priceCents"
          label="Price"
          currency={currency}
          description="0 for free shipping."
        />
        <MoneyField
          control={form.control}
          name="freeAboveCents"
          label="Free from (optional)"
          currency={currency}
          nullable
          description="Orders with at least this subtotal ship free."
        />
        <FormError form={form} />
        <Field orientation="horizontal" className="justify-between">
          <Button type="button" variant="ghost" onClick={onDone}>
            Skip for now
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Saving…' : 'Add and finish'}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
