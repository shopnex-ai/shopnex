'use client'

// ✨ Generate for pages: a draft of About, FAQ, shipping and the like from what the shop sells and the facts staff give.
// "Use" puts the draft into the page form as an unsaved change.
import { AI_LENGTHS, AI_PAGE_KINDS, AI_TONES, aiCapabilities } from '@shopnex/api/schemas'
import { AiDialog, options } from '@/components/admin/ai-dialog'
import { SelectField, TextareaField, useZodForm } from '@/components/admin/form'

const pageInput = aiCapabilities['page.content'].input

const KIND_LABELS = {
  about: 'About us',
  faq: 'FAQ',
  shipping: 'Shipping',
  returns: 'Returns and refunds',
  privacy: 'Privacy policy',
  terms: 'Terms of service',
  other: 'Something else (say what in the instructions)',
} satisfies Record<(typeof AI_PAGE_KINDS)[number], string>

export function GeneratePage({
  pageId,
  onUse,
}: {
  /** The page being edited; none while it hasn't been saved */
  pageId?: string
  onUse: (page: { title: string; bodyHtml: string }) => void
}) {
  const form = useZodForm(pageInput, {
    defaultValues: { kind: 'about', tone: 'neutral', length: 'medium', instructions: '' },
  })
  return (
    <AiDialog
      capability="page.content"
      subject={{ pageId }}
      title="Draft this page"
      description="Written from what your shop sells and the facts you give. Anything it doesn't know is left as [a placeholder] to fill in."
      input={() => new Promise((resolve) => void form.handleSubmit(resolve, () => resolve(null))())}
      fields={
        <>
          <SelectField
            control={form.control}
            name="kind"
            label="Page"
            options={AI_PAGE_KINDS.map((value) => ({ value, label: KIND_LABELS[value] }))}
          />
          <div className="grid grid-cols-2 gap-4">
            <SelectField control={form.control} name="tone" label="Tone" options={options(AI_TONES)} />
            <SelectField control={form.control} name="length" label="Length" options={options(AI_LENGTHS)} />
          </div>
          <TextareaField
            control={form.control}
            name="instructions"
            label="Facts and instructions"
            description="e.g. “30-day returns, we ship within 2 days from Lisbon, free shipping over €50”"
            rows={4}
          />
        </>
      }
      // Sanitized by Shopnex before it gets here
      preview={(output) => (
        <>
          <p className="text-base font-semibold">{output.title}</p>
          <div
            className="[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_strong]:font-semibold [&_em]:italic"
            dangerouslySetInnerHTML={{ __html: output.bodyHtml }}
          />
        </>
      )}
      onUse={onUse}
    />
  )
}
