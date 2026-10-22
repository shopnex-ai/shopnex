'use client'

// Forms validate with the same zod schemas the API uses (@shopnex/api/schemas), so the browser
// rejects exactly what the server would — before a round trip.
import { zodResolver } from '@hookform/resolvers/zod'
import { ORPCError } from '@orpc/client'
import { useEffect, useId, useState, type ComponentProps, type ReactNode } from 'react'
import {
  useController,
  useForm,
  type Control,
  type FieldPath,
  type FieldValues,
  type UseFormProps,
  type UseFormReturn,
} from 'react-hook-form'
import type { z } from 'zod'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import '@/lib/zod-messages'

export function useZodForm<TInput extends FieldValues, TOutput extends FieldValues>(
  schema: z.ZodType<TOutput, TInput>,
  props?: Omit<UseFormProps<TInput, unknown, TOutput>, 'resolver'>,
) {
  return useForm<TInput, unknown, TOutput>({ ...props, resolver: zodResolver(schema) })
}

// Fields don't care about the form's transformed (output) type
type AnyForm<T extends FieldValues> = UseFormReturn<T, any, any>

type BaseFieldProps<T extends FieldValues> = {
  control: Control<T, any, any>
  name: FieldPath<T>
  label: string
  description?: ReactNode
}

// Label + control + description + error, wired for accessibility
function FieldShell({
  id,
  label,
  description,
  error,
  children,
}: {
  id: string
  label: string
  description?: ReactNode
  error?: { message?: string }
  children: ReactNode
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError errors={[error]} />
    </Field>
  )
}

type TextFieldProps<T extends FieldValues> = BaseFieldProps<T> & {
  /** Empty input becomes null (for nullable columns) instead of '' */
  nullable?: boolean
} & Omit<ComponentProps<'input'>, 'name' | 'value' | 'defaultValue' | 'onChange' | 'onBlur'>

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  nullable,
  ...inputProps
}: TextFieldProps<T>) {
  const id = useId()
  const { field, fieldState } = useController({ control, name })
  return (
    <FieldShell id={id} label={label} description={description} error={fieldState.error}>
      <Input
        {...inputProps}
        id={id}
        ref={field.ref}
        name={field.name}
        value={field.value ?? ''}
        onBlur={field.onBlur}
        onChange={(e) => field.onChange(nullable && e.target.value === '' ? null : e.target.value)}
        aria-invalid={fieldState.invalid || undefined}
      />
    </FieldShell>
  )
}

export function TextareaField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  nullable,
  ...props
}: BaseFieldProps<T> & { nullable?: boolean } & Omit<
    ComponentProps<'textarea'>,
    'name' | 'value' | 'defaultValue' | 'onChange' | 'onBlur'
  >) {
  const id = useId()
  const { field, fieldState } = useController({ control, name })
  return (
    <FieldShell id={id} label={label} description={description} error={fieldState.error}>
      <Textarea
        {...props}
        id={id}
        ref={field.ref}
        name={field.name}
        value={field.value ?? ''}
        onBlur={field.onBlur}
        onChange={(e) => field.onChange(nullable && e.target.value === '' ? null : e.target.value)}
        aria-invalid={fieldState.invalid || undefined}
      />
    </FieldShell>
  )
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  options,
}: BaseFieldProps<T> & { options: readonly { value: string; label: string }[] }) {
  const id = useId()
  const { field, fieldState } = useController({ control, name })
  return (
    <FieldShell id={id} label={label} description={description} error={fieldState.error}>
      <Select items={options} value={field.value ?? null} onValueChange={(value) => field.onChange(value)}>
        <SelectTrigger id={id} ref={field.ref} onBlur={field.onBlur} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  )
}

/** string[] edited as comma-separated text ("summer, linen") */
export function TagsField<T extends FieldValues>({ control, name, label, description }: BaseFieldProps<T>) {
  const id = useId()
  const { field, fieldState } = useController({ control, name })
  const joined = ((field.value as string[] | undefined) ?? []).join(', ')
  // Local text so typing a trailing comma/space isn't normalized away mid-edit
  const [text, setText] = useState(joined)
  useEffect(() => setText((current) => (split(current).join(', ') === joined ? current : joined)), [joined])
  return (
    <FieldShell id={id} label={label} description={description} error={fieldState.error}>
      <Input
        id={id}
        ref={field.ref}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          field.onChange(split(e.target.value))
        }}
        onBlur={() => {
          setText(joined)
          field.onBlur()
        }}
        aria-invalid={fieldState.invalid || undefined}
      />
    </FieldShell>
  )
}

const split = (text: string) =>
  text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

/**
 * Integer minor units (cents) edited as a decimal amount ("19.99").
 * `nullable`: empty means null (e.g. no compare-at price).
 */
export function MoneyField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  currency,
  nullable,
}: BaseFieldProps<T> & { currency: string; nullable?: boolean }) {
  const id = useId()
  const { field, fieldState } = useController({ control, name })
  const cents = field.value as number | null | undefined
  const formatted = cents == null ? '' : (cents / 100).toFixed(2)
  const [text, setText] = useState(formatted)
  useEffect(
    () => setText((current) => (toCents(current) === (cents ?? null) ? current : formatted)),
    [cents, formatted],
  )
  return (
    <FieldShell id={id} label={label} description={description} error={fieldState.error}>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">
          {currency}
        </span>
        <Input
          id={id}
          ref={field.ref}
          inputMode="decimal"
          value={text}
          className="pl-12 tabular-nums"
          onChange={(e) => {
            setText(e.target.value)
            const next = toCents(e.target.value)
            if (next === null)
              field.onChange(nullable ? null : undefined) // empty: null, or "required"
            else if (Number.isNaN(next))
              field.onChange(e.target.value) // junk: zod reports "expected number"
            else field.onChange(next)
          }}
          onBlur={() => {
            if (toCents(text) !== null) setText(formatted)
            field.onBlur()
          }}
          aria-invalid={fieldState.invalid || undefined}
        />
      </div>
    </FieldShell>
  )
}

// "19.99" → 1999, "" → null, junk → NaN
function toCents(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, '')
  if (trimmed === '') return null
  if (!/^-?\d*(\.\d{0,2})?$/.test(trimmed)) return Number.NaN
  return Math.round(Number(trimmed) * 100)
}

/** Whole number; `nullable`: empty means null (e.g. stock not tracked) */
export function IntegerField<T extends FieldValues>(
  props: BaseFieldProps<T> & { nullable?: boolean } & Pick<ComponentProps<'input'>, 'placeholder' | 'min'>,
) {
  return <NumberField {...props} step={1} />
}

/** Number, decimals allowed unless `step` says otherwise (e.g. a tax rate of 8.875) */
export function NumberField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  nullable,
  step = 'any',
  ...props
}: BaseFieldProps<T> & { nullable?: boolean } & Pick<ComponentProps<'input'>, 'placeholder' | 'min' | 'max' | 'step'>) {
  const id = useId()
  const { field, fieldState } = useController({ control, name })
  return (
    <FieldShell id={id} label={label} description={description} error={fieldState.error}>
      <Input
        {...props}
        id={id}
        ref={field.ref}
        type="number"
        inputMode={step === 1 ? 'numeric' : 'decimal'}
        step={step}
        value={field.value ?? ''}
        className="tabular-nums"
        onBlur={field.onBlur}
        onChange={(e) => field.onChange(e.target.value === '' ? (nullable ? null : undefined) : e.target.valueAsNumber)}
        aria-invalid={fieldState.invalid || undefined}
      />
    </FieldShell>
  )
}

/** Date + time in the browser's time zone; empty means null */
export function DateTimeField<T extends FieldValues>({ control, name, label, description }: BaseFieldProps<T>) {
  const id = useId()
  const { field, fieldState } = useController({ control, name })
  const value = field.value as Date | string | null | undefined
  return (
    <FieldShell id={id} label={label} description={description} error={fieldState.error}>
      <Input
        id={id}
        ref={field.ref}
        type="datetime-local"
        value={value ? toLocalInput(new Date(value)) : ''}
        onBlur={field.onBlur}
        onChange={(e) => field.onChange(e.target.value ? new Date(e.target.value) : null)}
        aria-invalid={fieldState.invalid || undefined}
      />
    </FieldShell>
  )
}

// Date → "2026-10-21T14:30" (local time, what datetime-local inputs take)
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** boolean as a checkbox, label beside it */
export function CheckboxField<T extends FieldValues>({ control, name, label, description }: BaseFieldProps<T>) {
  const id = useId()
  const { field, fieldState } = useController({ control, name })
  return (
    <Field data-invalid={fieldState.error ? true : undefined}>
      <label htmlFor={id} className="flex items-center gap-2 text-[13px] font-medium">
        <input
          id={id}
          ref={field.ref}
          type="checkbox"
          name={field.name}
          checked={Boolean(field.value)}
          onBlur={field.onBlur}
          onChange={(e) => field.onChange(e.target.checked)}
          className="size-4 accent-brand"
        />
        {label}
      </label>
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError errors={[fieldState.error]} />
    </Field>
  )
}

/** Form-level error (set by `setServerError` when it can't be tied to a field) */
export function FormError<T extends FieldValues>({ form }: { form: AnyForm<T> }) {
  const message = form.formState.errors.root?.message
  return message ? <FieldError>{message}</FieldError> : null
}

/**
 * Shows an API error on the form: on a field when `fieldFor` maps its code (e.g. CONFLICT → email),
 * otherwise as the form-level error.
 */
export function setServerError<T extends FieldValues>(
  form: AnyForm<T>,
  error: unknown,
  fieldFor?: Partial<Record<string, FieldPath<T>>>,
) {
  const message = error instanceof Error ? error.message : 'Something went wrong'
  const field = error instanceof ORPCError ? fieldFor?.[error.code] : undefined
  form.setError(field ?? 'root', { message })
}
