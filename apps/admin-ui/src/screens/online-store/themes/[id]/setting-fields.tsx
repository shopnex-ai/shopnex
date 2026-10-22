'use client'

// One input per theme setting field type (ThemeSettingField in @shopnex/storefront-sdk/theme).
// Controlled: values live in the theme document, every change autosaves.
import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import type { ThemeSettingField, ThemeSettingValue, ThemeSettings } from '@shopnex/storefront-sdk/theme'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { orpc } from '@/lib/orpc'

// Select items can't be empty strings
const NONE = '__none'
// ThemeSettingValue's limit for strings
const MAX_CODE_LENGTH = 10_000

export function SettingFields({
  fields,
  values,
  onChange,
}: {
  fields: readonly ThemeSettingField[]
  /** Resolved: every field has a value */
  values: ThemeSettings
  onChange: (id: string, value: ThemeSettingValue) => void
}) {
  if (!fields.length) return <p className="text-sm text-muted-foreground">This section has no settings.</p>
  return (
    <FieldGroup>
      {fields.map((f) => (
        <SettingField key={f.id} field={f} value={values[f.id] ?? null} onChange={(v) => onChange(f.id, v)} />
      ))}
    </FieldGroup>
  )
}

function SettingField({
  field: f,
  value,
  onChange,
}: {
  field: ThemeSettingField
  value: ThemeSettingValue
  onChange: (value: ThemeSettingValue) => void
}) {
  const id = useId()
  const text = typeof value === 'string' ? value : ''

  if (f.type === 'checkbox') {
    return (
      <Field>
        <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="size-4 accent-primary"
          />
          {f.label}
        </label>
        {f.info && <FieldDescription>{f.info}</FieldDescription>}
      </Field>
    )
  }

  let input: React.ReactNode
  switch (f.type) {
    case 'textarea':
      input = <Textarea id={id} value={text} rows={4} onChange={(e) => onChange(e.target.value)} />
      break
    case 'code':
      input = (
        <div className="space-y-1">
          <Textarea
            id={id}
            value={text}
            rows={8}
            maxLength={MAX_CODE_LENGTH}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={f.language === 'css' ? '.my-class { color: #803f3b; }' : '<div>…</div>'}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono text-xs"
          />
          <p className="text-right text-xs text-muted-foreground tabular-nums">
            {text.length.toLocaleString()} / {MAX_CODE_LENGTH.toLocaleString()}
          </p>
        </div>
      )
      break
    case 'color':
      input = (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={f.label}
            value={text || '#000000'}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded border bg-transparent p-0.5"
          />
          <Input id={id} value={text} onChange={(e) => onChange(e.target.value)} className="font-mono" maxLength={7} />
        </div>
      )
      break
    case 'range': {
      const n = typeof value === 'number' ? value : f.min
      input = (
        <div className="flex items-center gap-3">
          <input
            id={id}
            type="range"
            min={f.min}
            max={f.max}
            step={f.step}
            value={n}
            onChange={(e) => onChange(Number(e.target.value))}
            className="flex-1 accent-primary"
          />
          <span className="w-12 text-right text-sm tabular-nums">
            {n}
            {f.unit}
          </span>
        </div>
      )
      break
    }
    case 'select':
      input = <Choice id={id} value={text} options={f.options} onChange={onChange} />
      break
    case 'collection':
      input = <CollectionChoice id={id} value={text} onChange={onChange} />
      break
    case 'image':
      input = (
        <div className="space-y-2">
          <Input id={id} value={text} placeholder="https://…" onChange={(e) => onChange(e.target.value)} />
          {/^https?:\/\//.test(text) && (
            <img src={text} alt="" className="h-24 w-full rounded-md border object-cover" />
          )}
        </div>
      )
      break
    default:
      input = (
        <Input
          id={id}
          value={text}
          placeholder={f.type === 'text' ? f.placeholder : f.type === 'url' ? '/collections/… or https://…' : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>{f.label}</FieldLabel>
      {input}
      {f.info && <FieldDescription>{f.info}</FieldDescription>}
    </Field>
  )
}

function Choice({
  id,
  value,
  options,
  onChange,
}: {
  id: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const items = options.map((o) => ({ ...o, value: o.value || NONE }))
  return (
    <Select items={items} value={value || NONE} onValueChange={(v) => onChange(v === NONE ? '' : String(v))}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function CollectionChoice({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const { data = [] } = useQuery(orpc.admin.collections.list.queryOptions({ input: { limit: 100, offset: 0 } }))
  const options = [{ value: '', label: 'None' }, ...data.map((c) => ({ value: c.slug, label: c.title }))]
  // A handle that no longer exists stays visible instead of silently reading "None"
  if (value && !data.some((c) => c.slug === value)) options.push({ value, label: `${value} (not found)` })
  return <Choice id={id} value={value} options={options} onChange={onChange} />
}
