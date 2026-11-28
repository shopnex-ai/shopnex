import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { storeImportInput } from '@shopnex/store-import/contract'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { orpc, type Outputs } from '@/lib/orpc'

type Job = Outputs['admin']['storeImport']['get']

const FRESH_FOR_MS = 15 * 60_000

/**
 * Paste a Shopify or WooCommerce address, watch it come across. Two places use it: the onboarding step after sign-up
 * (`onboarding`: starts by itself from the address in the link, then continues to naming the shop) and Settings → Import a store.
 */
export function StoreImportPanel({
  initialUrl,
  onboarding = false,
  onContinue,
}: {
  initialUrl?: string
  onboarding?: boolean
  onContinue?: () => void
}) {
  const queryClient = useQueryClient()
  const overview = useQuery(orpc.admin.storeImport.overview.queryOptions())
  const [url, setUrl] = useState(initialUrl ?? '')
  // Until it is touched, the box follows the shop: ticked while it has no products
  const [brandingChoice, setBrandingChoice] = useState<boolean | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const autoStarted = useRef(false)

  const start = useMutation({
    ...orpc.admin.storeImport.start.mutationOptions(),
    onSuccess: (job) => {
      setFormError(null)
      setJobId(job.id)
      void queryClient.invalidateQueries({ queryKey: orpc.admin.storeImport.key() })
    },
    onError: (error) => setFormError(error.message),
  })

  const job = useQuery({
    ...orpc.admin.storeImport.get.queryOptions({ input: { id: jobId ?? '00000000-0000-0000-0000-000000000000' } }),
    enabled: !!jobId,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1500 : false),
  })

  const submit = (address: string, asBranding: boolean) => {
    const parsed = storeImportInput.safeParse({ url: address, branding: asBranding })
    if (!parsed.success) return setFormError(parsed.error.issues[0]?.message ?? 'Enter your store address')
    start.mutate(parsed.data)
  }

  // Once the overview is in: follow an import that is already running (a reload), else start from the address in the link
  useEffect(() => {
    if (!onboarding || autoStarted.current || !overview.data) return
    autoStarted.current = true
    const latest = overview.data.latest
    const recent = latest && Date.now() - new Date(latest.createdAt).getTime() < FRESH_FOR_MS
    if (latest && recent && (latest.status === 'running' || latest.status === 'done')) setJobId(latest.id)
    else if (initialUrl) submit(initialUrl, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarding, overview.data])

  const current: Job | undefined = jobId ? job.data : undefined
  const running = start.isPending || current?.status === 'running'

  if (overview.isPending) return <Skeleton className="h-40 w-full" />
  if (overview.error) return <p className="text-sm text-destructive">{overview.error.message}</p>
  const fresh = overview.data?.fresh ?? true
  const branding = brandingChoice ?? fresh

  return (
    <div className="space-y-4">
      {!running && current?.status !== 'done' && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit(url, onboarding || branding)
          }}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="store-url">Your store address</Label>
            <Input
              id="store-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="shopify-store.com or woo-store.com"
              inputMode="url"
              autoComplete="url"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus={!onboarding}
            />
          </div>
          {!onboarding && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={branding}
                onChange={(event) => setBrandingChoice(event.target.checked)}
              />
              <span>
                <span className="font-medium">Set up my shop from this store.</span>
                <span className="block text-muted-foreground">
                  Uses its name, logo, currency, language and colors, and publishes a new theme copy. Leave this off to
                  only add products, collections and pages (the store must sell in your shop&apos;s currency).
                </span>
              </span>
            </label>
          )}
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          {current?.status === 'failed' && (
            <p role="alert" className="text-sm text-destructive">
              {current.error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={start.isPending}>
              Import this store
            </Button>
            {onboarding && onContinue && (
              <Button type="button" variant="ghost" onClick={onContinue}>
                Skip and set up by hand
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Reads the store&apos;s public catalog: no password and no access to your store. Works with Shopify and
            WooCommerce. Customers and orders are not part of it: bring those in with the CSV import.
          </p>
        </form>
      )}

      {running && <Progress job={current} origin={current?.origin ?? url} />}

      {current?.status === 'done' && current.counts && (
        <Result job={current} onboarding={onboarding} onContinue={onContinue} />
      )}
    </div>
  )
}

function Progress({ job, origin }: { job?: Job; origin: string }) {
  const percent = job && job.total > 0 ? Math.round((job.done / job.total) * 100) : null
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <p className="font-medium">Importing {origin.replace(/^https?:\/\//, '')}</p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-2 rounded-full bg-primary transition-all ${percent === null ? 'w-1/3 animate-pulse' : ''}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {job?.step ?? 'Starting'}
        {job && job.total > 0 ? `: ${job.done} of ${job.total}` : '…'}
      </p>
      <p className="text-sm text-muted-foreground">
        Most stores take a few seconds. A big WooCommerce store can take a couple of minutes: you can leave this page
        open.
      </p>
    </div>
  )
}

function Result({ job, onboarding, onContinue }: { job: Job; onboarding: boolean; onContinue?: () => void }) {
  const counts = job.counts!
  const sample = counts.total !== null && counts.total > counts.products
  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium">
          Added {counts.products} {counts.products === 1 ? 'product' : 'products'} from{' '}
          {job.origin.replace(/^https?:\/\//, '')}
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            {counts.variants} {counts.variants === 1 ? 'variant' : 'variants'}, {counts.collections}{' '}
            {counts.collections === 1 ? 'collection' : 'collections'} and {counts.pages}{' '}
            {counts.pages === 1 ? 'page' : 'pages'} (the usual shop pages).
          </li>
          {sample && (
            <li>
              A sample: the store has {counts.total} products and the first {counts.products} came across.
            </li>
          )}
          {counts.branded && (
            <li>
              Your shop now has the store&apos;s name, logo, colors, currency ({counts.currency})
              {counts.language ? ` and language (${counts.language})` : ''}.
            </li>
          )}
          {counts.skipped > 0 && <li>{counts.skipped} could not be added or were free placeholders.</li>}
        </ul>
      </div>
      {job.problems.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">What did not come across</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {job.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-sm text-muted-foreground">
        Check the catalog before anyone shops: stock is set to a placeholder (in stock or sold out), and your theme,
        apps and payments are set up separately.
      </p>
      <div className="flex flex-wrap gap-3">
        {onboarding ? (
          <Button onClick={onContinue}>Continue</Button>
        ) : (
          <>
            <Button render={<Link to="/admin/products" />}>View products</Button>
            <Button variant="outline" render={<Link to="/admin/collections" />}>
              View collections
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
