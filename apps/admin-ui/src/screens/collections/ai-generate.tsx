'use client'

// ✨ Generate for collections: description and search listing. "Use" puts the suggestion into the collection form
// as an unsaved change; nothing is saved until staff press Save.
import { aiCapabilities, AI_LENGTHS, AI_TONES } from '@shopnex/api/schemas'
import { AiDialog, options } from '@/components/admin/ai-dialog'
import { SelectField, TextareaField, useZodForm } from '@/components/admin/form'

/** Collections keep a plain-text description next to the HTML one: paragraphs and list items become lines */
export function htmlToPlainText(html: string) {
  const doc = new DOMParser().parseFromString(
    html.replace(/<\/(p|li|h[1-6])>/gi, '\n').replace(/<li>/gi, '• '),
    'text/html',
  )
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

const descriptionInput = aiCapabilities['collection.description'].input

export function GenerateCollectionDescription({
  collectionId,
  onUse,
}: {
  collectionId: string
  onUse: (descriptionHtml: string) => void
}) {
  const form = useZodForm(descriptionInput, { defaultValues: { tone: 'neutral', length: 'short', instructions: '' } })
  return (
    <AiDialog
      capability="collection.description"
      subject={{ collectionId }}
      title="Generate a description"
      description="Written from the collection's title and the products in it."
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
            description="Optional, e.g. “mention free returns”"
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

const seoInput = aiCapabilities['collection.seo'].input

export function GenerateCollectionSeo({
  collectionId,
  onUse,
}: {
  collectionId: string
  onUse: (seo: { title: string; description: string }) => void
}) {
  const form = useZodForm(seoInput, { defaultValues: { instructions: '' } })
  return (
    <AiDialog
      capability="collection.seo"
      subject={{ collectionId }}
      title="Generate a search listing"
      description="A page title and meta description for search engines."
      input={() => new Promise((resolve) => void form.handleSubmit(resolve, () => resolve(null))())}
      fields={
        <TextareaField
          control={form.control}
          name="instructions"
          label="Instructions"
          description="Optional, e.g. “target ‘linen summer dresses’”"
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
