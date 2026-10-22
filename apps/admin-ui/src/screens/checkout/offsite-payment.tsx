'use client'

import { useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { payNow } from './functions'

// An unpaid order paid through a payments app. Back from the provider the payment is usually still being
// confirmed (the app hears from the provider a moment later): poll until the order turns paid. Otherwise the
// buyer can (re)start paying.
export function OffsitePayment({
  token,
  methodName,
  status,
}: {
  token: string
  methodName: string | null
  status: 'pending' | 'resolved' | 'rejected' | 'expired' | null
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const confirming = status === 'pending'

  useEffect(() => {
    if (!confirming) return
    const timer = setInterval(() => void router.invalidate(), 3000)
    return () => clearInterval(timer)
  }, [confirming, router])

  async function onPay() {
    setStarting(true)
    setError(null)
    try {
      const result = await payNow({ data: token })
      if (result.redirectTo) return window.location.assign(result.redirectTo)
      setError(result.error ?? "Payment couldn't be started.")
    } catch {
      setError("Payment couldn't be started.")
    }
    setStarting(false)
  }

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-medium">Payment{methodName ? `: ${methodName}` : ''}</h2>
      <p className="text-sm text-muted-foreground">
        {confirming
          ? "Waiting for your payment to be confirmed. This page updates by itself. If you didn't finish paying, continue below."
          : "Your payment didn't go through. You can try again."}
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button size="lg" onClick={onPay} disabled={starting}>
        {starting ? 'Opening payment…' : confirming ? 'Continue to payment' : 'Pay now'}
      </Button>
    </section>
  )
}
