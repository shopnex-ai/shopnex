import { XIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { formatMoney } from '@/lib/money'
import { checkGiftCard } from './functions'
import { useCheckoutTotals } from './totals'

// Its own form (forms can't nest). Applying only checks the code and shows what it pays in the totals; the card is spent
// when the order is placed.
export function GiftCardForm({ token }: { token: string }) {
  const { giftCard, setGiftCard, creditCents, currency } = useCheckoutTotals()
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    const code = String(new FormData(event.currentTarget).get('giftCardCode') ?? '')
    try {
      const result = await checkGiftCard({ data: { token, code } })
      setError(result.error)
      if (result.code && result.balanceCents != null)
        setGiftCard({ code: result.code, balanceCents: result.balanceCents })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check this gift card.')
    } finally {
      setPending(false)
    }
  }

  if (giftCard) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>
          <span className="rounded-md bg-muted px-2 py-1 font-mono font-medium">
            {giftCard.code
              .replace(/[^a-z0-9]/gi, '')
              .slice(-4)
              .toUpperCase()}
          </span>
          <span className="ml-2 text-muted-foreground">
            {formatMoney(giftCard.balanceCents, currency)} balance
            {creditCents === 0 ? ' · nothing in this order can use it' : ''}
          </span>
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={() => setGiftCard(null)}>
          <XIcon />
          Remove
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          name="giftCardCode"
          placeholder="Gift card code"
          autoComplete="off"
          aria-label="Gift card code"
          aria-invalid={error ? true : undefined}
        />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? 'Checking…' : 'Apply'}
        </Button>
      </div>
      {error && <FieldError>{error}</FieldError>}
    </form>
  )
}
