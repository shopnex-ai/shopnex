'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { customFieldInput, customFieldPatch } from '@shopnex/api/schemas'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { DialogDeleteButton } from '@/components/admin/dialog-delete-button'
import {
  CheckboxField,
  FormError,
  SelectField,
  TagsField,
  TextField,
  setServerError,
  useZodForm,
} from '@/components/admin/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup } from '@/components/ui/field'
import { orpc, type Outputs } from '@/lib/orpc'
import { useWatch } from 'react-hook-form'

type CustomField = Outputs['admin']['customFields']['list'][number]

const resourceOptions = [
  { value: 'product', label: 'Products' },
  { value: 'order', label: 'Orders' },
  { value: 'customer', label: 'Customers' },
] as const
const typeOptions = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'choice', label: 'Choice' },
  { value: 'file', label: 'File' },
] as const
const labelOf = (options: readonly { value: string; label: string }[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value

const col = columnHelper<CustomField>()
const columns = [
  col.accessor('label', {
    header: 'Field',
    cell: ({ row: { original: f } }) => <span className="font-medium">{f.label}</span>,
  }),
  col.accessor('resource', { header: 'On', cell: (c) => labelOf(resourceOptions, c.getValue()) }),
  col.accessor('key', { header: 'Key', cell: (c) => <code className="font-mono text-xs">{c.getValue()}</code> }),
  col.accessor('type', { header: 'Type', cell: (c) => labelOf(typeOptions, c.getValue()) }),
  col.accessor('storefront', {
    header: 'Storefront',
    cell: (c) =>
      c.getValue() ? <Badge variant="secondary">Shown</Badge> : <span className="text-muted-foreground">Hidden</span>,
  }),
  col.display({
    id: 'actions',
    cell: ({ row: { original: f } }) => <EditButton field={f} />,
    meta: { className: 'text-right' },
  }),
]

export function CustomFieldsCard() {
  const { data, error, isPending } = useQuery(orpc.admin.customFields.list.queryOptions({ input: {} }))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom fields</CardTitle>
        <CardDescription>
          Extra fields on products, orders and customers. Fill them in on each record, then read them from themes (
          <code>product.custom_fields.key</code>), the APIs, webhooks and apps.
        </CardDescription>
        <CardAction>
          <NewFieldButton />
        </CardAction>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={data}
          getRowId={(f) => f.id}
          isPending={isPending}
          error={error}
          empty="No custom fields yet."
        />
      </CardContent>
    </Card>
  )
}

// "Care guide" → care_guide
const keyFromLabel = (label: string) =>
  label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+|_+$/g, '')
    .slice(0, 40)

function NewFieldButton() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [keyEdited, setKeyEdited] = useState(false)
  const form = useZodForm(customFieldInput, {
    defaultValues: { resource: 'product', key: '', label: '', type: 'text', options: [], storefront: false },
  })
  const type = useWatch({ control: form.control, name: 'type' })
  const create = useMutation(orpc.admin.customFields.create.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync(values)
      await queryClient.invalidateQueries({ queryKey: orpc.admin.customFields.key() })
      toast.success('Custom field added')
      setOpen(false)
      setKeyEdited(false)
      form.reset()
    } catch (error) {
      setServerError(form, error, { CONFLICT: 'key' })
    }
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <PlusIcon />
        New field
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New custom field</DialogTitle>
          <DialogDescription>The key and type can&apos;t be changed later.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <SelectField control={form.control} name="resource" label="Add to" options={resourceOptions} />
            <div
              // Typing the label fills in the key until the key is edited by hand
              onInput={(e) => {
                const input = e.target as HTMLInputElement
                if (input.name === 'label' && !keyEdited) form.setValue('key', keyFromLabel(input.value))
                if (input.name === 'key') setKeyEdited(true)
              }}
            >
              <FieldGroup>
                <TextField
                  control={form.control}
                  name="label"
                  label="Label"
                  placeholder="Care guide"
                  autoComplete="off"
                />
                <TextField
                  control={form.control}
                  name="key"
                  label="Key"
                  placeholder="care_guide"
                  autoComplete="off"
                  description="How themes and APIs refer to it, e.g. product.custom_fields.care_guide"
                />
              </FieldGroup>
            </div>
            <SelectField control={form.control} name="type" label="Type" options={typeOptions} />
            {type === 'choice' && (
              <TagsField control={form.control} name="options" label="Choices" description="Separate with commas" />
            )}
            <CheckboxField
              control={form.control}
              name="storefront"
              label="Show on the storefront"
              description="Themes and the Storefront API can read it. Leave off for internal notes."
            />
            <FormError form={form} />
            <Field orientation="horizontal" className="justify-end">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Adding…' : 'Add field'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditButton({ field }: { field: CustomField }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const form = useZodForm(customFieldPatch, {
    defaultValues: { label: field.label, storefront: field.storefront, options: field.options },
  })
  const update = useMutation(orpc.admin.customFields.update.mutationOptions())
  const remove = useMutation(orpc.admin.customFields.delete.mutationOptions())
  const [confirming, setConfirming] = useState(false)

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync({ id: field.id, ...values })
      await queryClient.invalidateQueries({ queryKey: orpc.admin.customFields.key() })
      toast.success('Custom field saved')
      setOpen(false)
    } catch (error) {
      setServerError(form, error)
    }
  })

  async function onDelete() {
    try {
      await remove.mutateAsync({ id: field.id })
      await queryClient.invalidateQueries({ queryKey: orpc.admin.customFields.key() })
      toast.success('Custom field deleted')
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the field')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setConfirming(false)
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Edit</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{field.label}</DialogTitle>
          <DialogDescription>
            {labelOf(resourceOptions, field.resource)} · <code>{field.key}</code> · {labelOf(typeOptions, field.type)}
          </DialogDescription>
        </DialogHeader>
        {confirming ? (
          <>
            <p className="text-sm">
              Delete “{field.label}”? The values saved under <code>{field.key}</code> on every {field.resource} are
              deleted too. This can&apos;t be undone.
            </p>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
              <Button variant="destructive" onClick={() => void onDelete()} disabled={remove.isPending}>
                {remove.isPending ? 'Deleting…' : 'Delete field'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup>
              <TextField control={form.control} name="label" label="Label" autoComplete="off" />
              {field.type === 'choice' && (
                <TagsField
                  control={form.control}
                  name="options"
                  label="Choices"
                  description="Separate with commas. Choices can be added, not removed."
                />
              )}
              <CheckboxField
                control={form.control}
                name="storefront"
                label="Show on the storefront"
                description="Themes and the Storefront API can read it."
              />
              <FormError form={form} />
              <Field orientation="horizontal" className="justify-between">
                <DialogDeleteButton onDelete={() => setConfirming(true)} pending={false} />
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? 'Saving…' : 'Save'}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
