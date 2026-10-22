'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CopyIcon, PlusIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form'
import { toast } from 'sonner'
import { appInput } from '@shopnex/api/schemas'
import { FormError, TextField, TextareaField, setServerError, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { orpc, type Outputs } from '@/lib/orpc'
import { scopeSummary } from '@/lib/scopes'
import { ScopesField } from '../settings/api-tokens-card'
import { AppIcon } from './installed-apps-card'

type App = Outputs['admin']['appRegistry']['list'][number]
type Credentials = { clientId: string; privateKey: string; redirectUri: string | undefined }

export function AppRegistryCard() {
  const { data, error, isPending } = useQuery(orpc.admin.appRegistry.list.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom apps</CardTitle>
        <CardDescription>
          Private apps for this Shopnex install, not listed in the marketplace (e.g. your own integrations). Only super
          admins see this.
        </CardDescription>
        <CardAction>
          <AppDialog />
        </CardAction>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : error ? (
          <p className="text-destructive">{error.message}</p>
        ) : data.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">No apps registered.</p>
        ) : (
          <ul className="divide-y surface-inset">
            {data.map((app) => (
              <li key={app.id} className="flex items-center gap-3 p-3">
                <AppIcon url={app.iconUrl} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{app.name}</div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{app.clientId}</div>
                  <div className="truncate text-xs text-muted-foreground">{scopeSummary(app.scopes)}</div>
                </div>
                <RotateKeyButton app={app} />
                <AppDialog app={app} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

const empty = { name: '', description: null, iconUrl: null, appUrl: '', redirectUrls: [] as string[], scopes: [] }

// Register when `app` is omitted, otherwise edit (or delete) it
function AppDialog({ app }: { app?: App }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const toValues = () =>
    app
      ? {
          name: app.name,
          description: app.description,
          iconUrl: app.iconUrl,
          appUrl: app.appUrl,
          redirectUrls: app.redirectUrls,
          scopes: app.scopes,
        }
      : empty
  const form = useZodForm(appInput, { defaultValues: toValues() })
  const register = useMutation(orpc.admin.appRegistry.register.mutationOptions())
  const update = useMutation(orpc.admin.appRegistry.update.mutationOptions())
  const remove = useMutation(orpc.admin.appRegistry.delete.mutationOptions())
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.appRegistry.key() })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (app) {
        await update.mutateAsync({ id: app.id, ...values })
        await refresh()
        toast.success('App saved')
        setOpen(false)
      } else {
        const created = await register.mutateAsync(values)
        await refresh()
        setCredentials({
          clientId: created.app.clientId,
          privateKey: created.privateKey,
          redirectUri: created.app.redirectUrls[0],
        })
      }
    } catch (error) {
      setServerError(form, error)
    }
  })

  async function onDelete() {
    try {
      await remove.mutateAsync({ id: app!.id })
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: orpc.admin.apps.key() })])
      toast.success('App deleted')
      setOpen(false)
    } catch (error) {
      setServerError(form, error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          form.reset(toValues())
          setCredentials(null)
        }
      }}
    >
      <DialogTrigger render={<Button variant={app ? 'ghost' : 'outline'} size="sm" />}>
        {app ? (
          'Edit'
        ) : (
          <>
            <PlusIcon />
            Register app
          </>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {credentials ? (
          <CredentialsView title="App registered" credentials={credentials} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{app ? `Edit ${app.name}` : 'Register app'}</DialogTitle>
              <DialogDescription>
                The app gets a client ID and secret to install itself on shops through OAuth.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} noValidate>
              <FieldGroup>
                <TextField
                  control={form.control}
                  name="name"
                  label="Name"
                  placeholder="Inventory Sync"
                  autoComplete="off"
                />
                <TextareaField control={form.control} name="description" label="Description" nullable rows={2} />
                <TextField
                  control={form.control}
                  name="iconUrl"
                  label="Icon URL"
                  type="url"
                  nullable
                  placeholder="https://…/icon.png"
                  autoComplete="off"
                />
                <TextField
                  control={form.control}
                  name="appUrl"
                  label="App URL"
                  type="url"
                  placeholder="https://app.example.com"
                  description="Opened by “Open” in Apps, with ?shop_id=… appended."
                  autoComplete="off"
                />
                <RedirectUrlsField control={form.control} />
                <ScopesField control={form.control} />
                <FormError form={form} />
                <Field orientation="horizontal" className="justify-between">
                  {app ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-destructive"
                      onClick={onDelete}
                      disabled={remove.isPending}
                    >
                      Delete
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? 'Saving…' : app ? 'Save' : 'Register app'}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// string[] edited as one URL per line
function RedirectUrlsField<T extends FieldValues>({ control }: { control: Control<T, any, any> }) {
  const id = useId()
  const { field, fieldState } = useController({ control, name: 'redirectUrls' as FieldPath<T> })
  const [text, setText] = useState(() => (field.value as string[]).join('\n'))
  const error = Array.isArray(fieldState.error) ? fieldState.error.find(Boolean) : fieldState.error
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>Redirect URLs</FieldLabel>
      <Textarea
        id={id}
        ref={field.ref}
        rows={2}
        value={text}
        placeholder="https://app.example.com/auth/callback"
        onBlur={field.onBlur}
        onChange={(e) => {
          setText(e.target.value)
          field.onChange(
            e.target.value
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean),
          )
        }}
      />
      <FieldDescription>
        Only for apps that run their own OAuth flow; one per line, redirect_uri must match one exactly. Leave empty for
        a managed app (@shopnex/app): shops install it right here and it opens inside the admin.
      </FieldDescription>
      <FieldError errors={[error]} />
    </Field>
  )
}

function CredentialsView({ title, credentials }: { title: string; credentials: Credentials }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          Give these to the app&apos;s developer (<code>SHOPNEX_CLIENT_ID</code>, <code>SHOPNEX_APP_KEY</code>). The
          private key is shown only now and never stored here: Shopnex keeps the public half. Rotate it if it&apos;s
          lost.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-sm">
        <Secret label="Client ID" value={credentials.clientId} />
        <Secret label="Private key" value={credentials.privateKey} />
        <p className="text-xs text-muted-foreground">
          {credentials.redirectUri ? (
            <>
              Install flow: send the merchant to <code className="break-all">/admin/oauth/authorize</code> with{' '}
              <code>client_id</code> and <code>redirect_uri</code>, then exchange the returned <code>code</code> at{' '}
              <code>POST /api/v1/oauth/token</code> with a client assertion signed by the key.
            </>
          ) : (
            <>
              Managed app: shops install it from Apps and it opens inside the admin. It gets Admin API tokens with the
              token exchange and client credentials grants at <code>POST /api/v1/oauth/token</code>.
            </>
          )}
        </p>
      </div>
      <DialogFooter>
        <DialogClose render={<Button />}>Done</DialogClose>
      </DialogFooter>
    </>
  )
}

function Secret({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium">{label}</div>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 rounded-md border bg-muted px-2 py-1.5 font-mono text-xs break-all">
          {value}
        </code>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value)
            toast.success(`${label} copied`)
          }}
        >
          <CopyIcon />
        </Button>
      </div>
    </div>
  )
}

function RotateKeyButton({ app }: { app: App }) {
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const rotate = useMutation(orpc.admin.appRegistry.rotateKey.mutationOptions())

  async function onRotate() {
    try {
      const rotated = await rotate.mutateAsync({ id: app.id })
      setCredentials({
        clientId: rotated.app.clientId,
        privateKey: rotated.privateKey,
        redirectUri: app.redirectUrls[0],
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not rotate key')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setCredentials(null)
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Rotate key</DialogTrigger>
      <DialogContent>
        {credentials ? (
          <CredentialsView title="New private key" credentials={credentials} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Rotate {app.name}&apos;s key?</DialogTitle>
              <DialogDescription>
                The current key stops working immediately: the app can&apos;t get new tokens until it has the new one.
                Installations stay.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
              <Button variant="destructive" onClick={onRotate} disabled={rotate.isPending}>
                {rotate.isPending ? 'Rotating…' : 'Rotate key'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
