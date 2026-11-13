'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { confirmUnsubscribe } from './functions'

export function UnsubscribePage({ token, email, shopName }: { token: string; email: string; shopName: string }) {
  const [state, setState] = useState<'ask' | 'working' | 'done' | 'failed'>('ask')
  const submit = async () => {
    setState('working')
    try {
      setState((await confirmUnsubscribe({ data: token })).ok ? 'done' : 'failed')
    } catch {
      setState('failed')
    }
  }
  return (
    <main className="mx-auto max-w-md space-y-4 p-10 text-center">
      <h1 className="text-xl font-semibold">{shopName}</h1>
      {state === 'done' ? (
        <p>
          <strong>{email}</strong> won't get cart reminders from {shopName} any more.
        </p>
      ) : (
        <>
          <p>
            Stop cart reminders from {shopName} to <strong>{email}</strong>?
          </p>
          {state === 'failed' && <p className="text-sm text-destructive">Something went wrong. Please try again.</p>}
          <Button onClick={() => void submit()} disabled={state === 'working'}>
            Unsubscribe
          </Button>
        </>
      )}
    </main>
  )
}
