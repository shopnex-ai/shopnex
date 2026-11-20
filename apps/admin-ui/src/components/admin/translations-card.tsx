// "Translate" on a product, collection or page: pick one of the shop's published languages and write the record's text in it,
// next to the original. A field left empty has no translation (the storefront shows the original); a translation made from
// text that has changed since is marked Outdated. Saves on its own, apart from the record's form.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { sourceDigest } from '@shopnex/languages/contract'
import { optionNameField, optionValueField } from '@shopnex/languages/schema'
import { RichTextEditor } from '@/components/admin/rich-text-editor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { languageOptions } from '@/lib/languages'
import { client, orpc } from '@/lib/orpc'

export type Resource = 'product' | 'collection' | 'page'

/** A field of the record: `html` fields are written in the rich text editor, `text` ones in a line */
export interface TranslatableField {
  key: string
  label: string
  /** Fields of one group sit under a heading of their own, like a product's options */
  group?: string
  kind: 'text' | 'html'
  /** The record's saved text in the shop's own language (what the translation is made from) */
  source: string
}

/**
 * What to translate on a product: its title and description, and (like Shopify) each option's name and values. Variants are
 * not translated: they are made of the option values.
 */
export function translatableProductFields(product: {
  title: string
  description: string | null
  descriptionHtml: string | null
  options: { id: string; name: string; optionValues: { id: string; name: string }[] }[]
}): TranslatableField[] {
  return [
    { key: 'title', label: 'Title', kind: 'text', source: product.title },
    {
      key: 'description',
      label: 'Description',
      kind: 'html',
      source: product.descriptionHtml ?? product.description ?? '',
    },
    ...product.options.flatMap((option): TranslatableField[] => [
      {
        key: optionNameField(option.id),
        label: 'Option name',
        group: 'Product options',
        kind: 'text',
        source: option.name,
      },
      ...option.optionValues.map((value): TranslatableField => ({
        key: optionValueField(value.id),
        label: `${option.name} value`,
        group: 'Product options',
        kind: 'text',
        source: value.name,
      })),
    ]),
  ]
}

export const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
export const nameOf = (code: string) => languageOptions(code).find((o) => o.value === code)?.label ?? code

export function TranslationsCard({
  resource,
  resourceId,
  fields,
}: {
  resource: Resource
  resourceId: string
  fields: TranslatableField[]
}) {
  const languages = useQuery(orpc.admin.languages.list.queryOptions())
  const [chosen, setChosen] = useState<string>()

  const published = languages.data?.languages ?? []
  const language = chosen && published.includes(chosen) ? chosen : published[0]

  // A shop in one language has nothing to translate into: no card (languages are added in Settings → Languages)
  if (languages.isPending || (!language && !languages.error)) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Translations</CardTitle>
        <CardDescription>
          The text shoppers read in another language. Anything left empty shows the original.{' '}
          <Link
            to="/admin/translations"
            search={{ resource, id: resourceId, language }}
            className="underline underline-offset-2"
          >
            Open in the translation workspace
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {languages.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : languages.error ? (
          <p className="text-sm text-destructive">{languages.error.message}</p>
        ) : !language ? (
          <p className="text-sm text-muted-foreground">
            You have not published another language.{' '}
            <Link to="/admin/settings/languages" className="underline">
              Add one in Settings → Languages
            </Link>{' '}
            to translate into it.
          </p>
        ) : (
          <div className="space-y-4">
            <Field>
              <FieldLabel>Language</FieldLabel>
              <Select
                items={published.map((code) => ({ value: code, label: nameOf(code) }))}
                value={language}
                onValueChange={(value) => setChosen(value ?? undefined)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {published.map((code) => (
                    <SelectItem key={code} value={code}>
                      {nameOf(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <LanguageForm
              key={language}
              resource={resource}
              resourceId={resourceId}
              language={language}
              fields={fields}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function LanguageForm({
  resource,
  resourceId,
  language,
  fields,
}: {
  resource: Resource
  resourceId: string
  language: string
  fields: TranslatableField[]
}) {
  const queryClient = useQueryClient()
  const rows = useQuery(
    orpc.admin.languages.translations.list.queryOptions({ input: { resource, resourceId, language } }),
  )
  if (rows.isPending) return <Skeleton className="h-40 w-full" />
  if (rows.error) return <p className="text-sm text-destructive">{rows.error.message}</p>
  return (
    <TranslationFields
      resource={resource}
      resourceId={resourceId}
      language={language}
      fields={fields}
      saved={Object.fromEntries(rows.data.map((r) => [r.field, r]))}
      onSaved={() => queryClient.invalidateQueries({ queryKey: orpc.admin.languages.translations.key() })}
    />
  )
}

export interface TranslationRow {
  value: string
  sourceDigest: string
}

/**
 * The state of translating one record into one language: what is typed, what changed, which fields are outdated, and saving.
 * Shared by the card on a record's page and the translation workspace, so both behave the same.
 */
export function useTranslationDrafts({
  resource,
  resourceId,
  language,
  fields,
  saved,
  onSaved,
}: {
  resource: Resource
  resourceId: string
  language: string
  fields: TranslatableField[]
  saved: Record<string, TranslationRow>
  onSaved: () => Promise<unknown>
}) {
  const initial = () => Object.fromEntries(fields.map((f) => [f.key, saved[f.key]?.value ?? '']))
  const [drafts, setDrafts] = useState<Record<string, string>>(initial)
  // The rich text editor reads its value once: bumped on discard so it starts over from what is saved
  const [version, setVersion] = useState(0)
  const isOutdated = (field: TranslatableField) => {
    const current = saved[field.key]
    return !!current && current.sourceDigest !== sourceDigest(field.source)
  }
  // `refresh`: the translations that are outdated are still right, so they are saved again against the text as it is now
  const save = useMutation({
    mutationFn: async (refresh: boolean) => {
      for (const field of fields) {
        const value = drafts[field.key] ?? ''
        if (value === (saved[field.key]?.value ?? '') && !(refresh && isOutdated(field))) continue
        await client.admin.languages.translations.set({
          resource,
          resourceId,
          language,
          field: field.key,
          value,
          source: field.source,
        })
      }
    },
    onSuccess: async (_data, refresh) => {
      await onSaved()
      toast.success(refresh ? 'Marked as up to date' : 'Translation saved')
    },
    onError: (error) => toast.error(error.message),
  })
  return {
    drafts,
    setDraft: (key: string, value: string) => setDrafts((d) => ({ ...d, [key]: value })),
    discard: () => {
      setDrafts(initial())
      setVersion((v) => v + 1)
    },
    version,
    dirty: fields.some((f) => (drafts[f.key] ?? '') !== (saved[f.key]?.value ?? '')),
    isOutdated,
    anyOutdated: fields.some(isOutdated),
    save: (refresh: boolean) => save.mutate(refresh),
    saving: save.isPending,
  }
}

function TranslationFields({
  resource,
  resourceId,
  language,
  fields,
  saved,
  onSaved,
}: {
  resource: Resource
  resourceId: string
  language: string
  fields: TranslatableField[]
  saved: Record<string, TranslationRow>
  onSaved: () => Promise<unknown>
}) {
  const t = useTranslationDrafts({ resource, resourceId, language, fields, saved, onSaved })

  return (
    <FieldGroup>
      {fields.map((field, index) => {
        const id = `translation-${resource}-${field.key}`
        return (
          <Field key={field.key}>
            {field.group && field.group !== fields[index - 1]?.group && (
              <p className="border-t pt-4 text-sm font-semibold">{field.group}</p>
            )}
            <div className="flex items-center gap-2">
              <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
              {t.isOutdated(field) && <Badge variant="outline">Outdated</Badge>}
            </div>
            <p className="line-clamp-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {(field.kind === 'html' ? plain(field.source) : field.source) || 'Nothing to translate yet'}
            </p>
            {field.kind === 'html' ? (
              <RichTextEditor
                id={id}
                value={t.drafts[field.key] ?? ''}
                onChange={(html) => t.setDraft(field.key, html)}
              />
            ) : (
              <Input
                id={id}
                value={t.drafts[field.key] ?? ''}
                onChange={(e) => t.setDraft(field.key, e.target.value)}
                placeholder={field.source}
              />
            )}
          </Field>
        )
      })}
      <Field orientation="horizontal" className="justify-end">
        {t.anyOutdated && (
          <Button type="button" variant="ghost" disabled={t.saving} onClick={() => t.save(true)}>
            Mark as up to date
          </Button>
        )}
        <Button type="button" variant="outline" disabled={!t.dirty || t.saving} onClick={() => t.save(false)}>
          {t.saving ? 'Saving…' : 'Save translation'}
        </Button>
      </Field>
    </FieldGroup>
  )
}
