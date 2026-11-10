'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Controller, type Control, type FieldValues } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { client, orpc, type Outputs } from '@/lib/orpc'

type CustomField = Outputs['admin']['customFields']['list'][number]
type Values = Record<string, string | number | boolean>
export type CustomFieldUpdates = Record<string, string | number | boolean | null>

const YES_NO = [
  { value: 'unset', label: '—' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]

// What the inputs hold as text; '' = not set
const toDraft = (field: CustomField, values: Values) => {
  const v = values[field.key]
  return v === undefined ? '' : field.type === 'boolean' ? (v ? 'yes' : 'no') : String(v)
}

// Uploads right away, like product media; the field then holds the file's URL
function FileInput({ id, value, onChange }: { id: string; value: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false)
  return (
    <div className="flex items-center gap-2">
      {value && (
        <a href={value} target="_blank" rel="noreferrer" className="truncate text-sm underline">
          {decodeURIComponent(value.split('/').pop() ?? value)}
        </a>
      )}
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
        disabled={uploading}
        className="min-w-0 flex-1 text-sm"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return
          setUploading(true)
          try {
            onChange((await client.admin.files.upload({ file })).url)
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Upload failed')
          } finally {
            setUploading(false)
            e.target.value = ''
          }
        }}
      />
      {value && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
          Remove
        </Button>
      )}
    </div>
  )
}

/** One input for a custom field, whatever its type; `value` is the text the input holds ('' = not set) */
function FieldInput({
  field: f,
  id,
  value,
  onChange,
}: {
  field: CustomField
  id: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <>
      {f.type === 'boolean' ? (
        <Select items={YES_NO} value={value || 'unset'} onValueChange={(v) => onChange(v === 'unset' ? '' : (v ?? ''))}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {YES_NO.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : f.type === 'choice' ? (
        <Select
          items={[{ value: 'unset', label: '—' }, ...f.options.map((o) => ({ value: o, label: o }))]}
          value={value || 'unset'}
          onValueChange={(v) => onChange(v === 'unset' ? '' : (v ?? ''))}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unset">—</SelectItem>
            {f.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : f.type === 'file' ? (
        <FileInput id={id} value={value} onChange={onChange} />
      ) : (
        <Input
          id={id}
          type={f.type === 'number' ? 'number' : 'text'}
          step={f.type === 'number' ? 'any' : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
      )}
    </>
  )
}

export function toValue(field: CustomField, draft: string): string | number | boolean | null {
  if (field.type === 'boolean') return draft === 'yes' ? true : draft === 'no' ? false : null
  const text = draft.trim()
  if (!text) return null
  return field.type === 'number' ? Number(text) : text
}

/**
 * The fields the shop defined for a product, order or customer, with the record's values. Shows nothing until the
 * shop has defined one. `save` gets only what changed (null clears a value) and rejects to keep the edits.
 */
export function CustomFieldsCard({
  resource,
  values,
  save,
}: {
  resource: CustomField['resource']
  values: Values
  save: (updates: CustomFieldUpdates) => Promise<unknown>
}) {
  const fields = useQuery(orpc.admin.customFields.list.queryOptions({ input: { resource } }))
  if (!fields.data?.length) return null
  // key: fresh inputs when the saved values change
  return <Editor key={JSON.stringify(values)} fields={fields.data} values={values} save={save} />
}

function Editor({
  fields,
  values,
  save,
}: {
  fields: CustomField[]
  values: Values
  save: (updates: CustomFieldUpdates) => Promise<unknown>
}) {
  const saved = Object.fromEntries(fields.map((f) => [f.key, toDraft(f, values)]))
  const [draft, setDraft] = useState(saved)
  const [saving, setSaving] = useState(false)
  const changed = fields.filter((f) => draft[f.key] !== saved[f.key])

  async function onSave() {
    const bad = changed.find(
      (f) => f.type === 'number' && draft[f.key]!.trim() && !Number.isFinite(Number(draft[f.key])),
    )
    if (bad) return toast.error(`${bad.label} must be a number`)
    setSaving(true)
    try {
      await save(Object.fromEntries(changed.map((f) => [f.key, toValue(f, draft[f.key]!)])))
      toast.success('Custom fields saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save custom fields')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom fields</CardTitle>
        <CardDescription>
          Defined in{' '}
          <Link to="/admin/settings/custom-fields" className="underline">
            Settings
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent
        // Enter saves these fields, not the form the card may sit in
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || (e.target as HTMLElement).tagName !== 'INPUT') return
          e.preventDefault()
          if (changed.length && !saving) void onSave()
        }}
      >
        <FieldGroup>
          {fields.map((f) => {
            const id = `custom-field-${f.key}`
            return (
              <Field key={f.id}>
                <FieldLabel htmlFor={id}>{f.label}</FieldLabel>
                <FieldInput
                  field={f}
                  id={id}
                  value={draft[f.key]!}
                  onChange={(v) => setDraft({ ...draft, [f.key]: v })}
                />
              </Field>
            )
          })}
          {changed.length > 0 && (
            <Field orientation="horizontal" className="justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(saved)}>
                Discard
              </Button>
              <Button type="button" size="sm" onClick={() => void onSave()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </Field>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

/** How a saved value reads in an input: the form keeps text, `toValue` turns it back into a typed value */
export const draftOf = (value: string | number | boolean) =>
  typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value)

/**
 * The same card inside a form: each field registers itself as `customFields.<key>`, so the form's own dirty state,
 * Save, Discard and reset cover it. A field that is not set is `undefined`, not '', so clearing an untouched
 * field is not a change.
 */
export function CustomFieldsFormCard<T extends FieldValues>({
  resource,
  control,
}: {
  resource: CustomField['resource']
  control: Control<T, any, any>
}) {
  const fields = useQuery(orpc.admin.customFields.list.queryOptions({ input: { resource } }))
  if (!fields.data?.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom fields</CardTitle>
        <CardDescription>
          Defined in{' '}
          <Link to="/admin/settings/custom-fields" className="underline">
            Settings
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {fields.data.map((f) => {
            const id = `custom-field-${f.key}`
            return (
              <Controller
                key={f.id}
                control={control}
                name={`customFields.${f.key}` as never}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor={id}>{f.label}</FieldLabel>
                    <FieldInput
                      field={f}
                      id={id}
                      value={(field.value as string | undefined) ?? ''}
                      onChange={(v) => field.onChange(v === '' ? undefined : v)}
                    />
                  </Field>
                )}
              />
            )
          })}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
