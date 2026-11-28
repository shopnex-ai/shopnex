import { XIcon } from 'lucide-react'
import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/money'
import { applyCode, removeDiscountCode } from './functions'
import { useCheckoutTotals } from './totals'

// One box for discount codes and gift cards (its own form: forms can't nest). A discount is saved on the cart and the
// page re-renders with the new totals; a gift card is only checked and shows what it pays in the totals, it is spent
// when the order is placed. A code that stopped applying (expired, cart changed…) stays visible so it can be removed.
// Once both kinds are applied the box goes away; with one applied it stays for the other.
export function CodeForm({ token, current }: { token: string; current: { code: string; applicable: boolean } | null }) {
  const { giftCard, setGiftCard, creditCents, currency } = useCheckoutTotals()
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)
  const [removing, startRemoving] = useTransition()
  const router = useRouter()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setPending(true)
    const code = String(new FormData(form).get('code') ?? '')
    try {
      const result = await applyCode({ data: { token, code } })
      setError(result.error)
      if (result.error) return
      form.reset()
      if (result.kind === 'giftCard' && result.code && result.balanceCents != null)
        setGiftCard({ code: result.code, balanceCents: result.balanceCents })
      else router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply this code.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-2">
      {current && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>
              <span className="rounded-md bg-muted px-2 py-1 font-mono font-medium">{current.code}</span>
              <span className="ml-2 text-muted-foreground">Discount</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={removing}
              onClick={() =>
                startRemoving(async () => {
                  await removeDiscountCode({ data: token })
                  router.invalidate()
                })
              }
            >
              <XIcon />
              Remove
            </Button>
          </div>
          {!current.applicable && (
            <FieldError>This code no longer applies to your order. Remove it to continue.</FieldError>
          )}
        </div>
      )}
      {giftCard && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>
            <span className="rounded-md bg-muted px-2 py-1 font-mono font-medium">
              {giftCard.code
                .replace(/[^a-z0-9]/gi, '')
                .slice(-4)
                .toUpperCase()}
            </span>
            <span className="ml-2 text-muted-foreground">
              Gift card · {formatMoney(giftCard.balanceCents, currency)} balance
              {creditCents === 0 ? ' · nothing in this order can use it' : ''}
            </span>
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setGiftCard(null)}>
            <XIcon />
            Remove
          </Button>
        </div>
      )}
      {!(current && giftCard) && (
        <form onSubmit={onSubmit} noValidate className="space-y-1.5">
          <div className="flex gap-2">
            <Input
              name="code"
              placeholder="Discount or gift card code"
              autoComplete="off"
              aria-label="Discount or gift card code"
              aria-invalid={error ? true : undefined}
            />
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? 'Applying…' : 'Apply'}
            </Button>
          </div>
          {error && <FieldError>{error}</FieldError>}
        </form>
      )}
    </div>
  )
}
