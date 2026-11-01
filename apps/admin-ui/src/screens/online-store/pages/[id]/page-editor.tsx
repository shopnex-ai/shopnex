'use client'

// Add (id null) or edit a page: title, content, visibility and its search engine listing.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useId, useState } from 'react'
import { useController } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { pageInput, slug } from '@shopnex/api/schemas'
import { CheckboxField, FormError, TextField, TextareaField, setServerError, useZodForm } from '@/components/admin/form'
import { PageHeader } from '@/components/admin/page-header'
import { RichTextEditor } from '@/components/admin/rich-text-editor'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { client, orpc, type Outputs } from '@/lib/orpc'
import { GeneratePage } from './ai-generate'

type Page = Outputs['admin']['pages']['get']

const back = { to: '/admin/online-store/pages', label: 'Pages' } as const

// Blank handle on a new page = generated from the title
const pageForm = pageInput.extend({
  handle: slug.or(z.literal('')),
  bodyHtml: z.string().max(500_000),
  published: z.boolean(),
})
type PageFormInput = z.input<typeof pageForm>

const toValues = (p: Page | null): PageFormInput => ({
  title: p?.title ?? '',
  handle: p?.handle ?? '',
  bodyHtml: p?.bodyHtml ?? '',
  seo: { title: p?.seoTitle ?? null, description: p?.seoDescription ?? null },
  published: p ? p.publishedAt !== null : true,
})

export function PageEditor({ id }: { id: string | null }) {
  const { data, error } = useQuery({
    ...orpc.admin.pages.get.queryOptions({ input: { id: id ?? '' } }),
    enabled: id !== null,
  })
  if (error) return <p className="text-sm text-destructive">{error.message}</p>
  if (id && !data) return <Skeleton className="h-96 w-full" />
  return <PageForm page={data ?? null} />
}

function PageForm({ page }: { page: Page | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const form = useZodForm(pageForm, { defaultValues: toValues(page) })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const bodyId = useId()
  const body = useController({ control: form.control, name: 'bodyHtml' })

  // After saving, the saved page is the new baseline (no unsaved changes)
  useEffect(() => form.reset(toValues(page)), [page, form])

  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.pages.key() })

  const onSubmit = form.handleSubmit(async ({ handle, ...values }) => {
    try {
      if (page) {
        const saved = await client.admin.pages.update({ id: page.id, ...values, handle: handle || page.handle })
        queryClient.setQueryData(orpc.admin.pages.get.queryKey({ input: { id: page.id } }), saved)
        await refresh()
        toast.success('Page saved')
      } else {
        const created = await client.admin.pages.create({ ...values, handle: handle || undefined })
        await refresh()
        toast.success('Page created')
        navigate({ to: '/admin/online-store/pages/$id', params: { id: created.id }, replace: true })
      }
    } catch (error) {
      setServerError(form, error, { CONFLICT: 'handle' })
    }
  })

  const remove = useMutation({
    mutationFn: () => client.admin.pages.delete({ id: page!.id }),
    onSuccess: async () => {
      await refresh()
      toast.success('Page deleted')
      navigate({ to: back.to })
    },
    onError: (e) => toast.error(e.message),
  })

  const title = form.watch('title')

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <PageHeader
        back={back}
        title={page ? page.title : 'Add page'}
        actions={
          <>
            {page && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={form.formState.isSubmitting || (page !== null && !form.formState.isDirty)}
            >
              {form.formState.isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      />
      <FormError form={form} />

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <Card>
          <CardContent>
            <FieldGroup>
              <TextField control={form.control} name="title" label="Title" placeholder="About us" />
              <Field>
                <FieldLabel htmlFor={bodyId}>Content</FieldLabel>
                <RichTextEditor
                  id={bodyId}
                  value={body.field.value}
                  onChange={body.field.onChange}
                  invalid={!!body.fieldState.error}
                  actions={
                    <GeneratePage
                      pageId={page?.id}
                      onUse={(draft) => {
                        // A title already typed stays; the draft's is for a page that has none yet
                        if (!form.getValues('title')) form.setValue('title', draft.title, { shouldDirty: true })
                        form.setValue('bodyHtml', draft.bodyHtml, { shouldDirty: true })
                      }}
                    />
                  }
                />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Visibility</CardTitle>
            </CardHeader>
            <CardContent>
              <CheckboxField
                control={form.control}
                name="published"
                label="Visible on the storefront"
                description="Hidden pages stay here and drop out of menus."
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Search engine listing</CardTitle>
              <CardDescription>The page&apos;s URL and how it appears in search results.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <TextField
                  control={form.control}
                  name="handle"
                  label="URL handle"
                  autoComplete="off"
                  placeholder={page ? undefined : 'From the title'}
                  description="/pages/…"
                />
                <TextField control={form.control} name="seo.title" label="Page title" nullable placeholder={title} />
                <TextareaField
                  control={form.control}
                  name="seo.description"
                  label="Meta description"
                  nullable
                  rows={3}
                />
              </FieldGroup>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {page?.title}?</DialogTitle>
            <DialogDescription>It disappears from the storefront and from menus that link to it.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Delete page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  )
}
