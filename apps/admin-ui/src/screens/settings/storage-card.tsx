'use client'

// Settings → Storage: where uploaded images go. The server's disk by default, or any S3-compatible bucket;
// presets only prefill the form with each provider's endpoint and URL formats.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { z } from 'zod'
import { s3Input } from '@shopnex/api/schemas'
import { CheckboxField, FormError, TextField, setServerError, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { orpc, type Outputs } from '@/lib/orpc'

type Settings = Outputs['admin']['storage']['get']
type TestResult = Outputs['admin']['storage']['test']
type S3Values = z.input<typeof s3Input>
type Preset = S3Values['preset']

type PresetInfo = {
  label: string
  region: string
  /** {region} is filled in; null when it needs something only the merchant knows (account id…) */
  endpoint: string | null
  endpointPlaceholder: string
  /** {bucket} and {region} are filled in */
  publicUrl: string | null
  publicUrlPlaceholder: string
  forcePathStyle: boolean
  publicAcl: boolean
  help: string
}

const presets: Record<Preset, PresetInfo> = {
  aws: {
    label: 'Amazon S3',
    region: 'us-east-1',
    endpoint: 'https://s3.{region}.amazonaws.com',
    endpointPlaceholder: 'https://s3.us-east-1.amazonaws.com',
    publicUrl: 'https://{bucket}.s3.{region}.amazonaws.com',
    publicUrlPlaceholder: 'https://my-bucket.s3.us-east-1.amazonaws.com',
    forcePathStyle: false,
    publicAcl: false,
    help: 'Allow public reads with a bucket policy, or put CloudFront in front and use its URL as the public URL.',
  },
  r2: {
    label: 'Cloudflare R2',
    region: 'auto',
    endpoint: null,
    endpointPlaceholder: 'https://<account-id>.r2.cloudflarestorage.com',
    publicUrl: null,
    publicUrlPlaceholder: 'https://pub-xxxx.r2.dev or https://files.yourshop.com',
    forcePathStyle: true,
    publicAcl: false,
    help: 'Create an R2 API token with Object Read & Write. Turn on public access (r2.dev or a custom domain) and use that address as the public URL.',
  },
  spaces: {
    label: 'DigitalOcean Spaces',
    region: 'nyc3',
    endpoint: 'https://{region}.digitaloceanspaces.com',
    endpointPlaceholder: 'https://nyc3.digitaloceanspaces.com',
    publicUrl: 'https://{bucket}.{region}.digitaloceanspaces.com',
    publicUrlPlaceholder: 'https://my-space.nyc3.digitaloceanspaces.com (or its CDN URL)',
    forcePathStyle: false,
    publicAcl: true,
    help: 'Create a Spaces access key. With the CDN on, use the CDN endpoint as the public URL.',
  },
  b2: {
    label: 'Backblaze B2',
    region: 'us-west-004',
    endpoint: 'https://s3.{region}.backblazeb2.com',
    endpointPlaceholder: 'https://s3.us-west-004.backblazeb2.com',
    publicUrl: 'https://{bucket}.s3.{region}.backblazeb2.com',
    publicUrlPlaceholder: 'https://my-bucket.s3.us-west-004.backblazeb2.com',
    forcePathStyle: false,
    publicAcl: false,
    help: 'Make the bucket Public, and create an application key for it. The region is in the bucket’s endpoint.',
  },
  minio: {
    label: 'MinIO',
    region: 'us-east-1',
    endpoint: null,
    endpointPlaceholder: 'https://minio.example.com',
    publicUrl: null,
    publicUrlPlaceholder: 'https://minio.example.com/my-bucket',
    forcePathStyle: true,
    publicAcl: false,
    help: 'Allow anonymous downloads on the bucket (mc anonymous set download). The public URL is usually {endpoint}/{bucket}.',
  },
  other: {
    label: 'Other S3-compatible',
    region: 'auto',
    endpoint: null,
    endpointPlaceholder: 'https://s3.example.com',
    publicUrl: null,
    publicUrlPlaceholder: 'https://files.example.com',
    forcePathStyle: false,
    publicAcl: false,
    help: 'Any service with an S3-compatible API: Wasabi, Hetzner, Scaleway, Supabase Storage, Google Cloud Storage (HMAC keys)…',
  },
}

const presetOptions = Object.entries(presets).map(([value, p]) => ({ value: value as Preset, label: p.label }))

const fill = (template: string, values: { region: string; bucket: string }) =>
  template.replace('{region}', values.region).replace('{bucket}', values.bucket)

const blank: S3Values = {
  preset: 'r2',
  endpoint: '',
  region: presets.r2.region,
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  publicUrl: '',
  forcePathStyle: presets.r2.forcePathStyle,
  publicAcl: presets.r2.publicAcl,
}

const toValues = (settings: Settings): S3Values =>
  settings.s3 ? { ...blank, ...settings.s3, secretAccessKey: '' } : blank

const stepLabels: Record<TestResult['steps'][number]['step'], string> = {
  upload: 'Upload a test file',
  public: 'Load it from the public URL',
  delete: 'Delete it',
}

export function StorageCard() {
  const { data: settings, error } = useQuery(orpc.admin.storage.get.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage</CardTitle>
        <CardDescription>
          Where uploaded images are kept. Changing it only affects new uploads; existing files stay where they are.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {settings ? (
          <StorageForm settings={settings} />
        ) : error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </CardContent>
    </Card>
  )
}

function StorageForm({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient()
  const [provider, setProvider] = useState(settings.provider)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const form = useZodForm(s3Input, { defaultValues: toValues(settings) })
  const update = useMutation(orpc.admin.storage.update.mutationOptions())
  const test = useMutation(orpc.admin.storage.test.mutationOptions())

  const preset = presets[form.watch('preset')]
  const hasSecret = Boolean(settings.s3?.hasSecret)

  const saved = (next: Settings, message: string) => {
    queryClient.setQueryData(orpc.admin.storage.get.queryKey(), next)
    form.reset(toValues(next))
    toast.success(message)
  }

  const applyPreset = (value: Preset) => {
    const next = presets[value]
    const bucket = form.getValues('bucket')
    const values = { region: next.region, bucket }
    form.setValue('preset', value, { shouldDirty: true })
    form.setValue('region', next.region, { shouldDirty: true })
    form.setValue('endpoint', next.endpoint ? fill(next.endpoint, values) : '', { shouldDirty: true })
    form.setValue('publicUrl', next.publicUrl && bucket ? fill(next.publicUrl, values) : '', { shouldDirty: true })
    form.setValue('forcePathStyle', next.forcePathStyle, { shouldDirty: true })
    form.setValue('publicAcl', next.publicAcl, { shouldDirty: true })
    setTestResult(null)
  }

  const runTest = form.handleSubmit(async (values) => {
    setTestResult(null)
    try {
      setTestResult(await test.mutateAsync(values))
    } catch (error) {
      setServerError(form, error)
    }
  })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      saved(await update.mutateAsync({ provider: 's3', s3: values }), 'New uploads go to your bucket')
      setTestResult(null)
    } catch (error) {
      setServerError(form, error)
    }
  })

  const switchToDisk = async () => {
    try {
      saved(await update.mutateAsync({ provider: 'local' }), 'New uploads go to this server’s disk')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save')
    }
  }

  const providerSelect = (
    <Field>
      <FieldLabel>Store files on</FieldLabel>
      <Select
        items={[
          { value: 'local', label: 'This server’s disk' },
          { value: 's3', label: 'S3-compatible bucket' },
        ]}
        value={provider}
        onValueChange={(value) => setProvider(value as Settings['provider'])}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="local">This server’s disk</SelectItem>
          <SelectItem value="s3">S3-compatible bucket</SelectItem>
        </SelectContent>
      </Select>
      <FieldDescription>
        {provider === 'local'
          ? 'Simple, and fine for one server. Back up the files folder along with the database.'
          : 'AWS S3, Cloudflare R2, DigitalOcean Spaces, Backblaze B2, MinIO and other S3-compatible services. Images load straight from the bucket or its CDN.'}
      </FieldDescription>
    </Field>
  )

  if (provider === 'local') {
    return (
      <FieldGroup>
        {providerSelect}
        {settings.provider !== 'local' && (
          <Field orientation="horizontal" className="justify-end">
            <Button type="button" variant="ghost" onClick={() => setProvider(settings.provider)}>
              Cancel
            </Button>
            <Button type="button" disabled={update.isPending} onClick={() => void switchToDisk()}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </Field>
        )}
      </FieldGroup>
    )
  }

  const { isSubmitting, isDirty } = form.formState
  const busy = isSubmitting || test.isPending

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        {providerSelect}
        <Field>
          <FieldLabel>Provider</FieldLabel>
          <Select
            items={presetOptions}
            value={form.watch('preset')}
            onValueChange={(value) => applyPreset(value as Preset)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {presetOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{preset.help}</FieldDescription>
        </Field>
        <TextField control={form.control} name="bucket" label="Bucket" autoComplete="off" />
        <TextField
          control={form.control}
          name="endpoint"
          label="Endpoint"
          type="url"
          placeholder={preset.endpointPlaceholder}
          autoComplete="off"
        />
        <TextField control={form.control} name="region" label="Region" autoComplete="off" />
        <TextField control={form.control} name="accessKeyId" label="Access key ID" autoComplete="off" />
        <TextField
          control={form.control}
          name="secretAccessKey"
          label="Secret access key"
          type="password"
          autoComplete="new-password"
          placeholder={hasSecret ? 'Saved. Leave empty to keep it' : undefined}
          description="Stored encrypted. It's never shown again."
        />
        <TextField
          control={form.control}
          name="publicUrl"
          label="Public URL"
          type="url"
          placeholder={preset.publicUrlPlaceholder}
          description="Where customers' browsers load images from: the bucket's public address or a CDN in front of it."
          autoComplete="off"
        />
        <CheckboxField
          control={form.control}
          name="forcePathStyle"
          label="Use path-style URLs ({endpoint}/{bucket})"
          description="Needed by MinIO and most self-hosted services."
        />
        <CheckboxField
          control={form.control}
          name="publicAcl"
          label="Mark each uploaded file as public (public-read ACL)"
          description="For services that make files public one by one, like Spaces. Leave off when the bucket itself is public."
        />

        {testResult && (
          <ul className="space-y-1.5 surface-inset p-3 text-sm">
            {testResult.steps.map((s) => (
              <li key={s.step} className="flex gap-2">
                {s.ok ? (
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <XIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                )}
                <span>
                  {stepLabels[s.step]}
                  {s.error && <span className="block text-muted-foreground">{s.error}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        <FormError form={form} />
        <Field orientation="horizontal" className="justify-end">
          {(isDirty || settings.provider !== 's3') && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                form.reset()
                setProvider(settings.provider)
                setTestResult(null)
              }}
            >
              Cancel
            </Button>
          )}
          <Button type="button" variant="outline" disabled={busy} onClick={() => void runTest()}>
            {test.isPending ? 'Testing…' : 'Test connection'}
          </Button>
          <Button type="submit" disabled={busy || (settings.provider === 's3' && !isDirty)}>
            {isSubmitting ? 'Testing and saving…' : 'Save'}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
