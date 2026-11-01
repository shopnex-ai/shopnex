'use client'

// Settings → AI: built-in AI (Claude or OpenAI) with the shop's own API key. On, it adds ✨ Generate to the product
// editor; staff review every suggestion before it's saved. Saving checks the key with the provider first.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { z } from 'zod'
import { aiSettingsInput } from '@shopnex/api/schemas'
import { FormError, SelectField, TextField, TextareaField, setServerError, useZodForm } from '@/components/admin/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { orpc, type Outputs } from '@/lib/orpc'

type Data = Outputs['admin']['aiSettings']['get']
type Values = z.input<typeof aiSettingsInput>

const toValues = ({ settings }: Data): Values => ({
  provider: settings?.provider ?? 'anthropic',
  apiKey: '',
  model: settings?.model ?? '',
  brandVoice: settings?.brandVoice ?? '',
})

export function AiCard() {
  const { data, error } = useQuery(orpc.admin.aiSettings.get.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI</CardTitle>
        <CardDescription>
          Writes product descriptions and search listings. Uses your own API key: generations are billed to your account
          with the provider.
        </CardDescription>
        {data && (
          <CardAction>
            <Badge variant={data.settings ? 'default' : 'secondary'}>{data.settings ? 'On' : 'Off'}</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {data ? (
          <AiForm data={data} />
        ) : error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </CardContent>
    </Card>
  )
}

function AiForm({ data }: { data: Data }) {
  const queryClient = useQueryClient()
  const form = useZodForm(aiSettingsInput, { defaultValues: toValues(data) })
  const update = useMutation(orpc.admin.aiSettings.update.mutationOptions())
  const turnOff = useMutation(orpc.admin.aiSettings.turnOff.mutationOptions())

  const providerId = form.watch('provider')
  const provider = data.providers.find((p) => p.id === providerId)!
  // The saved key only counts for the provider it belongs to
  const hasKey = data.settings?.provider === providerId

  const saved = async (next: Data, message: string) => {
    queryClient.setQueryData(orpc.admin.aiSettings.get.queryKey(), next)
    // ✨ Generate appears or disappears in the product editor
    await queryClient.invalidateQueries({ queryKey: orpc.admin.ai.capabilities.key() })
    form.reset(toValues(next))
    toast.success(message)
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const next = await update.mutateAsync(values)
      await saved(next, `AI is on with ${provider.name}`)
    } catch (error) {
      setServerError(form, error)
    }
  })

  const off = async () => {
    try {
      await saved(await turnOff.mutateAsync({}), 'AI is off and the key is deleted')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not turn AI off')
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <SelectField
          control={form.control}
          name="provider"
          label="Provider"
          options={data.providers.map((p) => ({ value: p.id, label: p.name }))}
        />
        <TextField
          control={form.control}
          name="apiKey"
          label="API key"
          type="password"
          autoComplete="off"
          placeholder={hasKey ? 'Saved (enter a new key to replace it)' : ''}
          description={`Create one at ${provider.keyHint}. It's stored encrypted.`}
        />
        <TextField
          control={form.control}
          name="model"
          label="Model"
          autoComplete="off"
          placeholder={provider.models[0]}
          description={`Leave empty for ${provider.models[0]}. Any model your key can use works, e.g. ${provider.models.join(', ')}.`}
        />
        <TextareaField
          control={form.control}
          name="brandVoice"
          label="Brand voice"
          rows={3}
          placeholder="Friendly and down to earth, short sentences, no exclamation marks."
          description="Optional. Applied to everything written for this shop."
        />
        <FormError form={form} />
        <Field orientation="horizontal" className="justify-end">
          {data.settings && (
            <Button type="button" variant="ghost" disabled={turnOff.isPending} onClick={() => void off()}>
              Turn off
            </Button>
          )}
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Checking the key…' : 'Save'}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
