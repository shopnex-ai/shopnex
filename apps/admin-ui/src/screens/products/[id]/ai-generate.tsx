'use client'

// ✨ Generate for products: description, search listing, image alt text and organization. Each opens the shared dialog
// (components/admin/ai-dialog); "Use" puts the suggestion into the product form as an unsaved change.
import { aiCapabilities, AI_LENGTHS, AI_TONES } from '@shopnex/api/schemas'
import { AiDialog, options } from '@/components/admin/ai-dialog'
import { CheckboxField, SelectField, TextareaField, useZodForm } from '@/components/admin/form'
import { Badge } from '@/components/ui/badge'

const descriptionInput = aiCapabilities['product.description'].input

export function GenerateDescription({
  productId,
  onUse,
}: {
  productId: string
  onUse: (descriptionHtml: string) => void
}) {
  const form = useZodForm(descriptionInput, { defaultValues: { tone: 'neutral', length: 'medium', instructions: '' } })
  return (
    <AiDialog
      capability="product.description"
      subject={{ productId }}
      title="Generate a description"
      description="Written from the product's title, options, tags and current description."
      input={() => new Promise((resolve) => void form.handleSubmit(resolve, () => resolve(null))())}
      fields={
        <>
          <div className="grid grid-cols-2 gap-4">
            <SelectField control={form.control} name="tone" label="Tone" options={options(AI_TONES)} />
            <SelectField control={form.control} name="length" label="Length" options={options(AI_LENGTHS)} />
          </div>
          <TextareaField
            control={form.control}
            name="instructions"
            label="Instructions"
            description="Optional, e.g. “mention it’s machine washable”"
            rows={2}
          />
        </>
      }
      // Sanitized by Shopnex before it gets here
      preview={(output) => (
        <div
          className="[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_strong]:font-semibold [&_em]:italic"
          dangerouslySetInnerHTML={{ __html: output.descriptionHtml }}
        />
      )}
      onUse={(output) => onUse(output.descriptionHtml)}
    />
  )
}

const seoInput = aiCapabilities['product.seo'].input

export function GenerateSeo({
  productId,
  onUse,
}: {
  productId: string
  onUse: (seo: { title: string; description: string }) => void
}) {
  const form = useZodForm(seoInput, { defaultValues: { instructions: '' } })
  return (
    <AiDialog
      capability="product.seo"
      subject={{ productId }}
      title="Generate a search listing"
      description="A page title and meta description for search engines."
      input={() => new Promise((resolve) => void form.handleSubmit(resolve, () => resolve(null))())}
      fields={
        <TextareaField
          control={form.control}
          name="instructions"
          label="Instructions"
          description="Optional, e.g. “target ‘linen summer dress’”"
          rows={2}
        />
      }
      preview={(output) => (
        <div className="space-y-1">
          <p className="font-medium text-primary">{output.title}</p>
          <p className="text-muted-foreground">{output.description}</p>
        </div>
      )}
      onUse={onUse}
    />
  )
}

const imageAltInput = aiCapabilities['product.image_alt'].input

// Alt text for the images that have none yet; the product's other alt texts stay as they are
export function GenerateImageAlt({
  productId,
  images,
  onUse,
}: {
  productId: string
  images: { url: string; alt: string | null }[]
  onUse: (alts: { position: number; alt: string }[]) => void
}) {
  const form = useZodForm(imageAltInput, { defaultValues: { onlyMissing: true, instructions: '' } })
  if (images.length === 0) return null
  return (
    <AiDialog
      capability="product.image_alt"
      subject={{ productId }}
      trigger="Generate alt text"
      title="Generate alt text"
      description="Describes what the model sees in each image, for screen readers and image search. Needs a model that can see images."
      input={() => new Promise((resolve) => void form.handleSubmit(resolve, () => resolve(null))())}
      fields={
        <>
          <CheckboxField
            control={form.control}
            name="onlyMissing"
            label="Only images without alt text"
            description="Up to 10 images per run."
          />
          <TextareaField
            control={form.control}
            name="instructions"
            label="Instructions"
            description="Optional, e.g. “mention the colour of the fabric”"
            rows={2}
          />
        </>
      }
      preview={(output) => (
        <ul className="space-y-3">
          {output.images.map(({ position, alt }) => (
            <li key={position} className="flex items-start gap-3">
              <img src={images[position]?.url} alt="" className="size-14 shrink-0 rounded-md border object-cover" />
              <p>{alt}</p>
            </li>
          ))}
          {output.images.length === 0 && <li className="text-muted-foreground">Nothing to describe.</li>}
        </ul>
      )}
      onUse={(output) => onUse(output.images)}
    />
  )
}

const classifyInput = aiCapabilities['product.classify'].input

// A product type, tags and collections, preferring what the shop already uses
export function GenerateClassification({
  productId,
  onUse,
}: {
  productId: string
  onUse: (suggestion: { productType: string; tags: string[]; collections: string[] }) => void
}) {
  const form = useZodForm(classifyInput, { defaultValues: { instructions: '' } })
  return (
    <AiDialog
      capability="product.classify"
      subject={{ productId }}
      trigger="Suggest"
      title="Suggest how to organize this"
      description="A product type, tags and collections, based on what the shop already uses."
      input={() => new Promise((resolve) => void form.handleSubmit(resolve, () => resolve(null))())}
      fields={
        <TextareaField
          control={form.control}
          name="instructions"
          label="Instructions"
          description="Optional, e.g. “this is a gift item”"
          rows={2}
        />
      }
      preview={(output) => (
        <dl className="space-y-3">
          <div>
            <dt className="text-xs text-muted-foreground">Product type</dt>
            <dd>{output.productType || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Tags (added to the current ones)</dt>
            <dd className="flex flex-wrap gap-1.5">
              {output.tags.length ? output.tags.map((tag) => <Badge key={tag}>{tag}</Badge>) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Collections (added right away)</dt>
            <dd className="flex flex-wrap gap-1.5">
              {output.collections.length
                ? output.collections.map((handle) => (
                    <Badge key={handle} variant="outline">
                      {handle}
                    </Badge>
                  ))
                : '—'}
            </dd>
          </div>
        </dl>
      )}
      onUse={onUse}
    />
  )
}
