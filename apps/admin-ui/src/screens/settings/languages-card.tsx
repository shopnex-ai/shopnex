import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { MAX_LANGUAGES } from '@shopnex/languages/schema'
import { languageOptions } from '@/lib/languages'
import { orpc } from '@/lib/orpc'

const nameOf = (code: string) => languageOptions(code).find((o) => o.value === code)?.label ?? code

export function LanguagesCard() {
  const queryClient = useQueryClient()
  const languages = useQuery(orpc.admin.languages.list.queryOptions())
  const [adding, setAdding] = useState<string | null>(null)
  const refresh = (data: unknown) => {
    queryClient.setQueryData(orpc.admin.languages.list.queryKey(), data as never)
    return queryClient.invalidateQueries({ queryKey: orpc.admin.languages.key() })
  }
  const publish = useMutation({
    ...orpc.admin.languages.publish.mutationOptions(),
    onSuccess: async (data) => {
      await refresh(data)
      setAdding(null)
      toast.success('Language added')
    },
    onError: (error) => toast.error(error.message),
  })
  const unpublish = useMutation({
    ...orpc.admin.languages.unpublish.mutationOptions(),
    onSuccess: async (data) => {
      await refresh(data)
      toast.success('Language removed. Its translations are kept.')
    },
    onError: (error) => toast.error(error.message),
  })

  const data = languages.data
  const taken = new Set(data ? [data.default, ...data.languages] : [])
  const options = languageOptions().filter((o) => !taken.has(o.value))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Languages</CardTitle>
        <CardDescription>
          Your storefront is written in your own language. Add others, then translate products, collections and pages
          into them from each one&apos;s page. Turn on the language selector in your theme so shoppers can choose.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {languages.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : languages.error ? (
          <p className="text-sm text-destructive">{languages.error.message}</p>
        ) : (
          <>
            <ul className="divide-y rounded-md border text-sm">
              <li className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="flex items-center gap-2">
                  {nameOf(data!.default)} <Badge variant="secondary">Default</Badge>
                </span>
                <Link to="/admin/settings/general" className="text-muted-foreground underline">
                  Change in General
                </Link>
              </li>
              {data!.languages.map((code) => (
                <li key={code} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span>{nameOf(code)}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={unpublish.isPending}
                    onClick={() => unpublish.mutate({ code })}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            {data!.languages.length > 0 && (
              <p className="text-sm text-muted-foreground">
                <Link to="/admin/translations" className="underline">
                  Translate your products, collections and pages
                </Link>
              </p>
            )}
            {data!.languages.length >= MAX_LANGUAGES ? (
              <p className="text-sm text-muted-foreground">A shop can publish up to {MAX_LANGUAGES} languages.</p>
            ) : (
              <Field orientation="horizontal">
                <FieldLabel className="sr-only">Add a language</FieldLabel>
                <Select items={options} value={adding} onValueChange={(value) => setAdding(value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Add a language" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!adding || publish.isPending}
                  onClick={() => adding && publish.mutate({ code: adding })}
                >
                  Add
                </Button>
              </Field>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
