'use client'

// Settings → Email: off by default, or any SMTP server. Every popular provider offers SMTP; presets only
// prefill the form with each one's host, port and username.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { z } from 'zod'
import { smtpInput } from '@shopnex/api/schemas'
import { FormError, IntegerField, TextField, setServerError, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { orpc, type Outputs } from '@/lib/orpc'

type Settings = Outputs['admin']['email']['get']
type TestResult = Outputs['admin']['email']['test']
type SmtpValues = z.input<typeof smtpInput>
type Preset = SmtpValues['preset']

type PresetInfo = {
  label: string
  host: string
  port: number
  /** Fixed by the provider (e.g. "apikey"); empty when it's the merchant's own login */
  username: string
  usernamePlaceholder: string
  passwordLabel: string
  help: string
}

const presets: Record<Preset, PresetInfo> = {
  resend: {
    label: 'Resend',
    host: 'smtp.resend.com',
    port: 465,
    username: 'resend',
    usernamePlaceholder: 'resend',
    passwordLabel: 'API key',
    help: 'Verify your domain in Resend first, then create an API key with sending access.',
  },
  postmark: {
    label: 'Postmark',
    host: 'smtp.postmarkapp.com',
    port: 587,
    username: '',
    usernamePlaceholder: 'Server API token',
    passwordLabel: 'Server API token',
    help: 'Use your server’s API token (Servers → API Tokens) as both the username and the password.',
  },
  sendgrid: {
    label: 'SendGrid',
    host: 'smtp.sendgrid.net',
    port: 587,
    username: 'apikey',
    usernamePlaceholder: 'apikey',
    passwordLabel: 'API key',
    help: 'Verify a sender or your domain, then create an API key with Mail Send access. The username is literally “apikey”.',
  },
  mailgun: {
    label: 'Mailgun',
    host: 'smtp.mailgun.org',
    port: 587,
    username: '',
    usernamePlaceholder: 'postmaster@mg.yourshop.com',
    passwordLabel: 'SMTP password',
    help: 'Use the SMTP credentials from your domain’s settings. Domains in the EU region use smtp.eu.mailgun.org.',
  },
  ses: {
    label: 'Amazon SES',
    host: 'email-smtp.us-east-1.amazonaws.com',
    port: 587,
    username: '',
    usernamePlaceholder: 'SMTP username (AKIA…)',
    passwordLabel: 'SMTP password',
    help: 'Create SMTP credentials in the SES console (your AWS access keys won’t work), and put your region in the host.',
  },
  brevo: {
    label: 'Brevo',
    host: 'smtp-relay.brevo.com',
    port: 587,
    username: '',
    usernamePlaceholder: 'Login shown under SMTP & API',
    passwordLabel: 'SMTP key',
    help: 'Find the login and create an SMTP key under SMTP & API → SMTP.',
  },
  gmail: {
    label: 'Gmail / Google Workspace',
    host: 'smtp.gmail.com',
    port: 465,
    username: '',
    usernamePlaceholder: 'you@gmail.com',
    passwordLabel: 'App password',
    help: 'Turn on 2-Step Verification and create an app password (myaccount.google.com/apppasswords). Google allows a few hundred messages a day: fine to start, not for a busy shop.',
  },
  other: {
    label: 'Other SMTP server',
    host: '',
    port: 587,
    username: '',
    usernamePlaceholder: 'Leave empty if the server needs no login',
    passwordLabel: 'Password',
    help: 'Any SMTP server: Mailjet, Zoho, your host’s mail server… For local testing, Mailpit on localhost port 1025 with no username.',
  },
}

const presetOptions = Object.entries(presets).map(([value, p]) => ({ value: value as Preset, label: p.label }))

const blank: SmtpValues = {
  preset: 'resend',
  host: presets.resend.host,
  port: presets.resend.port,
  username: presets.resend.username,
  password: '',
  fromName: '',
  fromEmail: '',
}

const toValues = (settings: Settings): SmtpValues =>
  settings.smtp ? { ...blank, ...settings.smtp, password: '' } : blank

const stepLabels: Record<TestResult['steps'][number]['step'], string> = {
  connect: 'Log in to the server',
  send: 'Send a test email to you',
}

export function EmailCard() {
  const { data: settings, error } = useQuery(orpc.admin.email.get.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Email</CardTitle>
        <CardDescription>
          Messages go out from your own address through an email provider. While email is off, nothing is sent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {settings ? (
          <EmailForm settings={settings} />
        ) : error ? (
          <p className="text-sm text-destructive">{error.message}</p>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </CardContent>
    </Card>
  )
}

function EmailForm({ settings }: { settings: Settings }) {
  const queryClient = useQueryClient()
  const [provider, setProvider] = useState(settings.provider)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const form = useZodForm(smtpInput, { defaultValues: toValues(settings) })
  const update = useMutation(orpc.admin.email.update.mutationOptions())
  const test = useMutation(orpc.admin.email.test.mutationOptions())

  const preset = presets[form.watch('preset')]
  const hasPassword = Boolean(settings.smtp?.hasPassword)

  const saved = (next: Settings, message: string) => {
    queryClient.setQueryData(orpc.admin.email.get.queryKey(), next)
    form.reset(toValues(next))
    toast.success(message)
  }

  const applyPreset = (value: Preset) => {
    const next = presets[value]
    form.setValue('preset', value, { shouldDirty: true })
    form.setValue('host', next.host, { shouldDirty: true })
    form.setValue('port', next.port, { shouldDirty: true })
    form.setValue('username', next.username, { shouldDirty: true })
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
      saved(await update.mutateAsync({ provider: 'smtp', smtp: values }), `Email is sent through ${values.host}`)
      setTestResult(null)
    } catch (error) {
      setServerError(form, error)
    }
  })

  const turnOff = async () => {
    try {
      saved(await update.mutateAsync({ provider: 'off' }), 'Email is off')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save')
    }
  }

  const providerSelect = (
    <Field>
      <FieldLabel>Send email</FieldLabel>
      <Select
        items={[
          { value: 'off', label: 'Off' },
          { value: 'smtp', label: 'Through an email provider (SMTP)' },
        ]}
        value={provider}
        onValueChange={(value) => setProvider(value as Settings['provider'])}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="off">Off</SelectItem>
          <SelectItem value="smtp">Through an email provider (SMTP)</SelectItem>
        </SelectContent>
      </Select>
      <FieldDescription>
        {provider === 'off'
          ? 'Nothing is sent; messages only show up in the server log.'
          : 'Resend, Postmark, SendGrid, Mailgun, Amazon SES, Brevo, Gmail, or any other SMTP server.'}
      </FieldDescription>
    </Field>
  )

  if (provider === 'off') {
    return (
      <FieldGroup>
        {providerSelect}
        {settings.provider !== 'off' && (
          <Field orientation="horizontal" className="justify-end">
            <Button type="button" variant="ghost" onClick={() => setProvider(settings.provider)}>
              Cancel
            </Button>
            <Button type="button" disabled={update.isPending} onClick={() => void turnOff()}>
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
        <TextField
          control={form.control}
          name="fromEmail"
          label="From address"
          type="email"
          placeholder="orders@yourshop.com"
          description="Use an address on a domain you've verified with the provider, or messages may land in spam."
          autoComplete="off"
        />
        <TextField
          control={form.control}
          name="fromName"
          label="From name"
          placeholder="Your shop's name"
          autoComplete="off"
        />
        <TextField
          control={form.control}
          name="host"
          label="SMTP host"
          placeholder="smtp.example.com"
          autoComplete="off"
        />
        <IntegerField
          control={form.control}
          name="port"
          label="Port"
          min={1}
          description="465 uses TLS from the start; other ports switch to TLS before logging in."
        />
        <TextField
          control={form.control}
          name="username"
          label="Username"
          placeholder={preset.usernamePlaceholder}
          autoComplete="off"
        />
        <TextField
          control={form.control}
          name="password"
          label={preset.passwordLabel}
          type="password"
          autoComplete="new-password"
          placeholder={hasPassword ? 'Saved. Leave empty to keep it' : undefined}
          description="Stored encrypted. It's never shown again."
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
          {(isDirty || settings.provider !== 'smtp') && (
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
            {test.isPending ? 'Sending…' : 'Send test email'}
          </Button>
          <Button type="submit" disabled={busy || (settings.provider === 'smtp' && !isDirty)}>
            {isSubmitting ? 'Checking and saving…' : 'Save'}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
