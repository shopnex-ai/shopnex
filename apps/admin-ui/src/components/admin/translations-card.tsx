// "Translate" on a product, collection or page: pick one of the shop's published languages and write the record's text in it,
// next to the original. A field left empty has no translation (the storefront shows the original); a translation made from
// text that has changed since is marked Outdated. Saves on its own, apart from the record's form.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { sourceDigest } from '@shopnex/languages/contract'
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

type Resource = 'product' | 'collection' | 'page'

/** A field of the record: `html` fields are written in the rich text editor, `text` ones in a line */
export interface TranslatableField {
  key: string
  label: string
  kind: 'text' | 'html'
  /** The record's saved text in the shop's own language (what the translation is made from) */
  source: string
}

const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const nameOf = (code: string) => languageOptions().find((o) => o.value === code)?.label ?? code

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Translations</CardTitle>
        <CardDescription>
          The text shoppers read in another language. Anything left empty shows the original.
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
  saved: Record<string, { value: string; sourceDigest: string }>
  onSaved: () => Promise<unknown>
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, saved[f.key]?.value ?? ''])),
  )
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
  const dirty = fields.some((f) => (drafts[f.key] ?? '') !== (saved[f.key]?.value ?? ''))

  return (
    <FieldGroup>
      {fields.map((field) => {
        const outdated = isOutdated(field)
        const id = `translation-${resource}-${field.key}`
        return (
          <Field key={field.key}>
            <div className="flex items-center gap-2">
              <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
              {outdated && <Badge variant="outline">Outdated</Badge>}
            </div>
            <p className="line-clamp-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {(field.kind === 'html' ? plain(field.source) : field.source) || 'Nothing to translate yet'}
            </p>
            {field.kind === 'html' ? (
              <RichTextEditor
                id={id}
                value={drafts[field.key] ?? ''}
                onChange={(html) => setDrafts((d) => ({ ...d, [field.key]: html }))}
              />
            ) : (
              <Input
                id={id}
                value={drafts[field.key] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [field.key]: e.target.value }))}
                placeholder={field.source}
              />
            )}
          </Field>
        )
      })}
      <Field orientation="horizontal" className="justify-end">
        {fields.some(isOutdated) && (
          <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => save.mutate(true)}>
            Mark as up to date
          </Button>
        )}
        <Button type="button" variant="outline" disabled={!dirty || save.isPending} onClick={() => save.mutate(false)}>
          {save.isPending ? 'Saving…' : 'Save translation'}
        </Button>
      </Field>
    </FieldGroup>
  )
}
