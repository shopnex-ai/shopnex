import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLoaderData, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ShopnexBrand } from '@/components/admin/shopnex-logo'
import { orpc } from '@/lib/orpc'
import { SCOPE_RESOURCES, accessOf } from '@/lib/scopes'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { approveConsent, denyConsent } from './functions'

export function ConsentPage() {
  const data = useLoaderData({ from: '/admin/oauth/authorize' })
  const [pending, setPending] = useState(false)
  const router = useRouter()
  const queryClient = useQueryClient()
  if ('error' in data && data.error) return <Shell title="Can't install this app" description={data.error} />
  if (!('app' in data)) return null
  const go = async (approve: boolean) => {
    setPending(true)
    try {
      const url = approve ? await approveConsent({ data: data.request }) : await denyConsent({ data: data.request })
      if (url.startsWith('/')) {
        // Back inside the admin: no page reload, but the sidebar's installed apps must pick up the change
        await queryClient.invalidateQueries({ queryKey: orpc.admin.apps.key() })
        await router.navigate({ href: url })
      } else {
        window.location.assign(url) // the app's site: leaves the admin
      }
      // Stay "pending" on success: the page is about to go away, and re-enabling the buttons now would flash them
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong')
      setPending(false)
    }
  }
  return (
    <Shell title={`${data.installed ? 'Update' : 'Install'} ${data.app.name}`} description={`on ${data.tenant.name}`}>
      <CardContent className="space-y-4 text-sm">
        {data.app.description && <p className="text-muted-foreground">{data.app.description}</p>}
        <div>
          <p className="mb-2 font-medium">This app will be able to:</p>
          <ul className="divide-y surface-inset">
            {SCOPE_RESOURCES.map((r) => {
              const access = accessOf(data.scopes, r.key)
              if (access === 'none') return null
              return (
                <li key={r.key} className="px-3 py-2">
                  <div className="font-medium">
                    {access === 'write' ? 'View and change' : 'View'} {r.label.toLowerCase()}
                  </div>
                  <div className="text-xs text-muted-foreground">{r.hint}</div>
                </li>
              )
            })}
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">
          {data.host ? (
            <>
              You&apos;ll be sent to <span className="font-mono">{data.host}</span>.{' '}
            </>
          ) : (
            'It opens right here in your admin. '
          )}
          You can uninstall it any time in Apps.
        </p>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="ghost" disabled={pending} onClick={() => go(false)}>
          Cancel
        </Button>
        <Button disabled={pending} onClick={() => go(true)}>
          {pending ? 'Working…' : data.installed ? 'Update app' : 'Install app'}
        </Button>
      </CardFooter>
    </Shell>
  )
}

function Shell({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return (
    // Inside the admin layout, which already pads the content: no fixed height to fit, so it can't overflow
    <div className="mx-auto flex w-full max-w-md flex-col items-center py-4 md:py-8">
      <ShopnexBrand />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {children}
      </Card>
    </div>
  )
}
