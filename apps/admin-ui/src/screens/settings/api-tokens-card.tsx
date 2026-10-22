'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CopyIcon, PlusIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form'
import { toast } from 'sonner'
import { apiTokenInput, type ApiScope } from '@shopnex/api/schemas'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { FormError, TextField, setServerError, useZodForm } from '@/components/admin/form'
import { Badge } from '@/components/ui/badge'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate, formatDateTime } from '@/lib/format'
import { orpc, type Outputs } from '@/lib/orpc'
import { SCOPE_RESOURCES, accessOf, scopeSummary, type Access } from '@/lib/scopes'

type ApiToken = Outputs['admin']['apiTokens']['list'][number]

const ACCESS_OPTIONS = [
  { value: 'none', label: 'No access' },
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Read and write' },
] as const

const col = columnHelper<ApiToken>()
const columns = [
  col.accessor('name', {
    header: 'Name',
    cell: ({ row: { original: t } }) => (
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {t.name}
          {t.revokedAt && <Badge variant="outline">Revoked</Badge>}
        </div>
        <div className="truncate text-xs text-muted-foreground">{scopeSummary(t.scopes)}</div>
      </div>
    ),
    meta: { className: 'max-w-64' },
  }),
  col.accessor('tokenPrefix', {
    header: 'Token',
    cell: ({ row: { original: t } }) => <code className="font-mono text-xs">{t.tokenPrefix}…</code>,
  }),
  col.accessor('lastUsedAt', {
    header: 'Last used',
    cell: ({ row: { original: t } }) => (
      <span className="text-muted-foreground tabular-nums">
        {t.lastUsedAt ? formatDateTime(t.lastUsedAt) : 'Never'}
      </span>
    ),
  }),
  col.display({
    id: 'actions',
    cell: ({ row: { original: t } }) => (t.revokedAt ? null : <RevokeButton apiToken={t} />),
    meta: { className: 'text-right' },
  }),
]

export function ApiTokensCard() {
  const { data, error, isPending } = useQuery(orpc.admin.apiTokens.list.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>API tokens</CardTitle>
        <CardDescription>
          Secret tokens for apps and scripts that work with this shop&apos;s data through the{' '}
          <a href="/api/v1/docs" target="_blank" className="underline">
            Admin API
          </a>
          . Each token only gets the permissions you grant. Keep them out of browser code.
        </CardDescription>
        <CardAction>
          <NewTokenButton />
        </CardAction>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={data}
          getRowId={(t) => t.id}
          isPending={isPending}
          error={error}
          empty="No API tokens yet."
        />
      </CardContent>
    </Card>
  )
}

function NewTokenButton() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  // Shown once, right after creating
  const [created, setCreated] = useState<string | null>(null)
  const form = useZodForm(apiTokenInput, { defaultValues: { name: '', scopes: [] } })
  const create = useMutation(orpc.admin.apiTokens.create.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const token = await create.mutateAsync(values)
      await queryClient.invalidateQueries({ queryKey: orpc.admin.apiTokens.key() })
      setCreated(token.token)
    } catch (error) {
      setServerError(form, error)
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          form.reset()
          setCreated(null)
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <PlusIcon />
        New token
      </DialogTrigger>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Copy your token</DialogTitle>
              <DialogDescription>
                This is the only time it&apos;s shown. Store it somewhere safe; if it&apos;s lost, revoke it and create
                a new one.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-1">
              <code className="min-w-0 flex-1 rounded-md border bg-muted px-2 py-1.5 font-mono text-xs break-all">
                {created}
              </code>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Copy token"
                onClick={async () => {
                  await navigator.clipboard.writeText(created)
                  toast.success('Token copied')
                }}
              >
                <CopyIcon />
              </Button>
            </div>
            <DialogFooter>
              <DialogClose render={<Button />}>Done</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New API token</DialogTitle>
              <DialogDescription>Name it after the app or integration that will use it.</DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} noValidate>
              <FieldGroup>
                <TextField
                  control={form.control}
                  name="name"
                  label="Name"
                  placeholder="Inventory sync"
                  autoComplete="off"
                />
                <ScopesField control={form.control} />
                <FormError form={form} />
                <Field orientation="horizontal" className="justify-end">
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? 'Creating…' : 'Create token'}
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

// One access level per resource, stored as scopes (write_x, or read_x)
export function ScopesField<T extends FieldValues>({ control }: { control: Control<T, any, any> }) {
  const id = useId()
  const { field, fieldState } = useController({ control, name: 'scopes' as FieldPath<T> })
  const scopes: ApiScope[] = field.value
  const setAccess = (resource: string, access: Access) => {
    const rest = scopes.filter((s) => !s.endsWith(`_${resource}`))
    field.onChange(access === 'none' ? rest : [...rest, `${access}_${resource}` as ApiScope])
  }
  return (
    <Field data-invalid={fieldState.error ? true : undefined}>
      <FieldLabel id={id}>Permissions</FieldLabel>
      <div role="group" aria-labelledby={id} className="divide-y surface-inset">
        {SCOPE_RESOURCES.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-4 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-medium">{r.label}</div>
              <div className="text-xs text-muted-foreground">{r.hint}</div>
            </div>
            <Select
              items={ACCESS_OPTIONS}
              value={accessOf(scopes, r.key)}
              onValueChange={(value) => setAccess(r.key, value as Access)}
            >
              <SelectTrigger aria-label={`${r.label} access`} onBlur={field.onBlur} className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCESS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      <FieldDescription>
        Webhooks: a token can subscribe to the events of what it can read (e.g. <code>order.*</code> needs Orders).
        Settings, staff and tokens are never reachable with a token.
      </FieldDescription>
      <FieldError errors={[fieldState.error]} />
    </Field>
  )
}

function RevokeButton({ apiToken }: { apiToken: ApiToken }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const revoke = useMutation(orpc.admin.apiTokens.revoke.mutationOptions())

  async function onRevoke() {
    try {
      await revoke.mutateAsync({ id: apiToken.id })
      // Its webhooks are deleted with it
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.admin.apiTokens.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.admin.webhooks.key() }),
      ])
      toast.success('Token revoked')
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not revoke token')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Revoke</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke “{apiToken.name}”?</DialogTitle>
          <DialogDescription>
            Apps using this token stop working immediately and the webhooks it created are deleted. Created{' '}
            {formatDate(apiToken.createdAt)}. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button variant="destructive" onClick={onRevoke} disabled={revoke.isPending}>
            {revoke.isPending ? 'Revoking…' : 'Revoke token'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
