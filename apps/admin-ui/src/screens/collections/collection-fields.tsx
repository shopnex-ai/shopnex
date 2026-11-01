import { collectionInput } from '@shopnex/api/schemas'
import { TextField, TextareaField, useZodForm } from '@/components/admin/form'
import { FieldGroup } from '@/components/ui/field'
import { GenerateCollectionDescription, GenerateCollectionSeo, htmlToPlainText } from './ai-generate'

type Values = {
  title: string
  slug?: string
  description?: string | null
  descriptionHtml?: string | null
  seo?: { title?: string | null; description?: string | null }
}

// One form for creating and editing, so the fields and their validation are the same on both pages
export const useCollectionForm = (defaultValues: Values) => useZodForm(collectionInput, { defaultValues })

// Title, handle, description and search listing. With `collectionId` (a saved collection) the ✨ Generate buttons show:
// "Use" puts the suggestion into the form as an unsaved change
export function CollectionFields({
  control,
  setValue,
  collectionId,
  isNew,
}: {
  control: ReturnType<typeof useCollectionForm>['control']
  setValue: ReturnType<typeof useCollectionForm>['setValue']
  collectionId?: string
  isNew?: boolean
}) {
  return (
    <FieldGroup>
      <TextField control={control} name="title" label="Title" placeholder="Summer linen" />
      <TextField
        control={control}
        name="slug"
        label="Handle"
        placeholder="summer-linen"
        description={isNew ? 'Leave empty to generate it from the title.' : undefined}
      />
      {collectionId && (
        <div className="-mb-3 flex justify-end">
          <GenerateCollectionDescription
            collectionId={collectionId}
            onUse={(html) => {
              setValue('descriptionHtml', html, { shouldDirty: true })
              setValue('description', htmlToPlainText(html), { shouldDirty: true })
            }}
          />
        </div>
      )}
      <TextareaField control={control} name="description" label="Description (optional)" nullable />
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Search engine listing</p>
        {collectionId && (
          <GenerateCollectionSeo
            collectionId={collectionId}
            onUse={(seo) => {
              setValue('seo.title', seo.title, { shouldDirty: true })
              setValue('seo.description', seo.description, { shouldDirty: true })
            }}
          />
        )}
      </div>
      <TextField control={control} name="seo.title" label="Page title" nullable />
      <TextareaField control={control} name="seo.description" label="Meta description" nullable />
    </FieldGroup>
  )
}
