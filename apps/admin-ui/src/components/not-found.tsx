import { Link, type ToOptions } from '@tanstack/react-router'
import { SearchXIcon } from 'lucide-react'
import { Page } from '@/components/admin/page'
import { PageHeader } from '@/components/admin/page-header'
import { Button } from '@/components/ui/button'
import { isMissing } from '@/lib/not-found'

type Back = { to: ToOptions['to']; label: string }

/**
 * What the admin shows when what was asked for is not there: a URL that matches nothing, or a record that was removed
 * (or belongs to another shop). It says what is missing and offers one way on, the list it belongs to or Home. It stays
 * a page, not a redirect: the person sees what happened and the Back button still works.
 */
export function NotFound({
  title = 'Page not found',
  message = 'It may have been removed, moved, or belong to another shop.',
  back,
}: {
  title?: string
  message?: string
  /** Where to go instead; Home when left out */
  back?: Back
}) {
  return (
    <Page width="narrow">
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <SearchXIcon className="size-10 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
        <Button nativeButton={false} render={<Link to={back?.to ?? '/admin'} />}>
          {back ? `Back to ${back.label}` : 'Back to Home'}
        </Button>
      </div>
    </Page>
  )
}

/**
 * What a detail screen shows when its record did not load: the not-found page when the record is gone (or the id in the
 * URL is not valid), the error itself otherwise.
 */
export function LoadError({ error, noun, back }: { error: Error; noun: string; back: Back }) {
  if (isMissing(error)) return <NotFound title={`${noun} not found`} back={back} />
  return (
    <div className="space-y-4">
      <PageHeader back={back} title={`Could not load ${noun.toLowerCase()}`} />
      <p className="text-muted-foreground">{error.message}</p>
    </div>
  )
}
