import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { shopInput } from '@shopnex/tenancy/contract'
import { FormError, setServerError, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { countryName, countryOptions } from '@/lib/countries'
import { orpc, type Outputs } from '@/lib/orpc'

type Shop = Outputs['admin']['shop']['get']

const countriesInput = shopInput.pick({ shipToCountries: true })
const toCountries = (shop: Shop) => ({ shipToCountries: shop.shipToCountries })

export function ShipToCountriesCard() {
  const shop = useQuery(orpc.admin.shop.get.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ship-to countries</CardTitle>
        <CardDescription>
          The countries you sell to. With two or more, a theme can show a country picker (switch it on in the theme
          editor). Prices stay in {shop.data?.currency ?? 'your shop currency'}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {shop.data ? (
          <ShipToCountriesForm key={shop.data.id} shop={shop.data} />
        ) : shop.error ? (
          <p className="text-sm text-destructive">{shop.error.message}</p>
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </CardContent>
    </Card>
  )
}

function ShipToCountriesForm({ shop }: { shop: Shop }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const form = useZodForm(countriesInput, { defaultValues: toCountries(shop) })
  const update = useMutation(orpc.admin.shop.update.mutationOptions())
  const selected = form.watch('shipToCountries')

  const toggle = (code: string, on: boolean) =>
    form.setValue('shipToCountries', on ? [...selected, code] : selected.filter((c) => c !== code), {
      shouldDirty: true,
    })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync(values)
      queryClient.setQueryData(orpc.admin.shop.get.queryKey(), saved)
      form.reset(toCountries(saved))
      toast.success('Ship-to countries saved')
    } catch (error) {
      setServerError(form, error)
    }
  })

  const query = search.trim().toLowerCase()
  const shown = query ? countryOptions.filter((c) => c.label.toLowerCase().includes(query)) : countryOptions
  const { isSubmitting, isDirty } = form.formState

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <p className="text-sm text-muted-foreground">
          {selected.length === 0
            ? 'None chosen: one market, visitors get no choice.'
            : selected.length === 1
              ? `${countryName(selected[0]!)} only: visitors get no choice.`
              : `${selected.length} countries: visitors can choose where they ship to.`}
        </p>
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search countries"
          aria-label="Search countries"
        />
        <ul className="grid max-h-64 gap-1 overflow-y-auto rounded-md border p-2 text-sm sm:grid-cols-2">
          {shown.map((c) => (
            <li key={c.value}>
              <label className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted">
                <input
                  type="checkbox"
                  checked={selected.includes(c.value)}
                  onChange={(e) => toggle(c.value, e.target.checked)}
                />
                {c.label}
              </label>
            </li>
          ))}
          {shown.length === 0 && <li className="px-1 text-muted-foreground">No country matches.</li>}
        </ul>
        <FormError form={form} />
        {isDirty && (
          <Field orientation="horizontal" className="justify-end">
            <Button type="button" variant="ghost" disabled={isSubmitting} onClick={() => form.reset()}>
              Discard
            </Button>
            <Button type="submit" variant="outline" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </Field>
        )}
      </FieldGroup>
    </form>
  )
}
