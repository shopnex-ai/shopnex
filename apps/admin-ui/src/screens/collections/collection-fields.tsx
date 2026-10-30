import { collectionInput } from '@shopnex/api/schemas'
import { TextField, TextareaField, useZodForm } from '@/components/admin/form'
import { FieldGroup } from '@/components/ui/field'

type Values = { title: string; slug?: string; description?: string | null }

// One form for creating and editing, so the fields and their validation are the same on both pages
export const useCollectionForm = (defaultValues: Values) => useZodForm(collectionInput, { defaultValues })

// Title, handle and description
export function CollectionFields({
  control,
  isNew,
}: {
  control: ReturnType<typeof useCollectionForm>['control']
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
      <TextareaField control={control} name="description" label="Description (optional)" nullable />
    </FieldGroup>
  )
}
