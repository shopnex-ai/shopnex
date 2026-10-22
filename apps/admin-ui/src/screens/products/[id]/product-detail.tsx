'use client'

import { ORPCError } from '@orpc/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { productFields } from '@shopnex/api/schemas'
import {
  FormError,
  SelectField,
  TagsField,
  TextField,
  TextareaField,
  setServerError,
  useZodForm,
} from '@/components/admin/form'
import { PageHeader } from '@/components/admin/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { orpc, type Outputs } from '@/lib/orpc'
import { MediaCard } from './media-card'
import { VariantsCard } from './variants-card'

export type Product = Outputs['admin']['products']['get']

const productForm = productFields.pick({
  title: true,
  status: true,
  description: true,
  vendor: true,
  productType: true,
  tags: true,
  slug: true,
  seo: true,
})

const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'draft', label: 'Draft' },
  { value: 'archived', label: 'Archived' },
] as const

const back = { to: '/admin/products', label: 'Products' } as const

// Plain text of an HTML description (this component only renders in the browser, after the query)
function htmlToText(html: string) {
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>|<\/(p|li|h\d)>/gi, '$&\n'), 'text/html')
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

const toValues = (p: Product) => ({
  title: p.title,
  status: p.status,
  description: p.description ?? (p.descriptionHtml ? htmlToText(p.descriptionHtml) : null),
  vendor: p.vendor,
  productType: p.productType,
  tags: p.tags,
  slug: p.slug,
  seo: { title: p.seoTitle, description: p.seoDescription },
})

export function ProductDetail({ id, currency }: { id: string; currency: string }) {
  const product = useQuery(orpc.admin.products.get.queryOptions({ input: { id } }))

  if (product.isPending) {
    return (
      <div className="space-y-4">
        <PageHeader back={back} title={<Skeleton className="h-8 w-64" />} />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }
  if (product.error) {
    // BAD_REQUEST: the id in the URL isn't a valid uuid
    const notFound =
      product.error instanceof ORPCError && (product.error.code === 'NOT_FOUND' || product.error.code === 'BAD_REQUEST')
    return (
      <div className="space-y-4">
        <PageHeader back={back} title={notFound ? 'Product not found' : 'Could not load product'} />
        <p className="text-muted-foreground">
          {notFound ? 'It may have been removed, or it belongs to another shop.' : product.error.message}
        </p>
      </div>
    )
  }
  // key: fresh form defaults if another product loads into this view
  return <ProductEditor key={product.data.id} product={product.data} currency={currency} />
}

function ProductEditor({ product, currency }: { product: Product; currency: string }) {
  const queryClient = useQueryClient()
  const form = useZodForm(productForm, { defaultValues: toValues(product) })
  const update = useMutation(orpc.admin.products.update.mutationOptions())
  const { isDirty, isSubmitting, dirtyFields } = form.formState

  const onSubmit = form.handleSubmit(async ({ description, ...values }) => {
    try {
      const saved = await update.mutateAsync({
        id: product.id,
        ...values,
        // Only touch the description when it was edited: plain text replaces any HTML formatting
        ...(dirtyFields.description && { description, descriptionHtml: null }),
      })
      queryClient.setQueryData(orpc.admin.products.get.queryKey({ input: { id: product.id } }), saved)
      await queryClient.invalidateQueries({ queryKey: orpc.admin.products.list.key() })
      form.reset(toValues(saved))
      toast.success('Product saved')
    } catch (error) {
      setServerError(form, error, { CONFLICT: 'slug' })
    }
  })

  return (
    <div className="space-y-6">
      <PageHeader
        back={back}
        title={
          <span className="flex items-center gap-3">
            {product.title}
            <Badge variant={product.status === 'active' ? 'default' : 'secondary'} className="capitalize">
              {product.status}
            </Badge>
          </span>
        }
      />

      <form onSubmit={onSubmit} noValidate className="space-y-6">
        {isDirty && (
          <div className="sticky top-2 z-10 flex items-center justify-between gap-3 rounded-xl bg-card/95 px-4 py-2 shadow-flyout backdrop-blur">
            <span className="text-sm font-medium">Unsaved changes</span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => form.reset()}>
                Discard
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
        <FormError form={form} />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <Card>
              <CardContent>
                <FieldGroup>
                  <TextField control={form.control} name="title" label="Title" />
                  <TextareaField
                    control={form.control}
                    name="description"
                    label="Description"
                    nullable
                    rows={6}
                    description={
                      product.descriptionHtml
                        ? 'This description has formatting. Editing it here saves plain text and removes the formatting.'
                        : undefined
                    }
                  />
                </FieldGroup>
              </CardContent>
            </Card>

            <MediaCard product={product} />

            <VariantsCard product={product} currency={currency} />
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
              </CardHeader>
              <CardContent>
                <SelectField
                  control={form.control}
                  name="status"
                  label="Status"
                  options={statusOptions}
                  description="Only active products are visible on storefronts."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Organization</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <TextField control={form.control} name="vendor" label="Vendor" />
                  <TextField control={form.control} name="productType" label="Product type" />
                  <TagsField control={form.control} name="tags" label="Tags" description="Separate with commas" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Collections</p>
                    {product.collectionSlugs.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {product.collectionSlugs.map((slug) => (
                          <Badge key={slug} variant="outline">
                            {slug}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Not in any collection</p>
                    )}
                  </div>
                </FieldGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Search engine listing</CardTitle>
                <CardDescription>How this product appears in search results and its URL.</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <TextField control={form.control} name="slug" label="URL handle" autoComplete="off" />
                  <TextField
                    control={form.control}
                    name="seo.title"
                    label="Page title"
                    nullable
                    placeholder={product.title}
                  />
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
      </form>
    </div>
  )
}
