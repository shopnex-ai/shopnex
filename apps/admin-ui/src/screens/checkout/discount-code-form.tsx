'use client'

import { XIcon } from 'lucide-react'
import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { applyDiscountCode, removeDiscountCode, type DiscountCodeState } from './functions'

// Its own form (forms can't nest): applying re-renders the page with the discounted totals.
// A code that stopped applying (expired, cart changed…) stays visible so the buyer can remove it.
export function DiscountCodeForm({
  token,
  current,
}: {
  token: string
  current: { code: string; applicable: boolean } | null
}) {
  const [state, setState] = useState<DiscountCodeState>({})
  const [pending, setPending] = useState(false)
  const [removing, startRemoving] = useTransition()
  const router = useRouter()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    const code = String(new FormData(event.currentTarget).get('code') ?? '')
    try {
      const result = await applyDiscountCode({ data: { token, code } })
      setState(result)
      if (!result.error) router.invalidate()
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : 'Could not apply this code.' })
    } finally {
      setPending(false)
    }
  }

  if (current) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="rounded-md bg-muted px-2 py-1 font-mono font-medium">{current.code}</span>
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
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-1.5">
      <div className="flex gap-2">
        <Input
          name="code"
          placeholder="Discount code"
          autoComplete="off"
          aria-label="Discount code"
          aria-invalid={state.error ? true : undefined}
        />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? 'Applying…' : 'Apply'}
        </Button>
      </div>
      {state.error && <FieldError>{state.error}</FieldError>}
    </form>
  )
}
