'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CopyIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { domainInput } from '@shopnex/api/schemas'
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
import { Field, FieldGroup } from '@/components/ui/field'
import { formatDate } from '@/lib/format'
import { orpc, type Outputs } from '@/lib/orpc'

type Domain = Outputs['admin']['domains']['list']['domains'][number]

export function DomainsCard() {
  const { data, error, isPending } = useQuery(orpc.admin.domains.list.queryOptions())

  const col = columnHelper<Domain>()
  const columns = [
    col.accessor('domain', {
      header: 'Domain',
      cell: ({ row: { original: d } }) => <span className="font-medium">{d.domain}</span>,
    }),
    col.display({
      id: 'status',
      header: 'Status',
      cell: ({ row: { original: d } }) =>
        d.verified ? (
          <span className="flex items-center gap-2">
            <Badge variant="secondary">Verified</Badge>
            <span className="text-xs text-muted-foreground">{formatDate(d.verifiedAt!)}</span>
          </span>
        ) : (
          <Badge variant="outline">Pending verification</Badge>
        ),
    }),
    col.display({
      id: 'actions',
      cell: ({ row: { original: d } }) => (
        <span className="flex justify-end gap-1">
          {!d.verified && <VerifyButton domain={d} />}
          <DeleteDomainButton domain={d} />
        </span>
      ),
      meta: { className: 'text-right' },
    }),
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Domains</CardTitle>
        <CardDescription>
          Add the address your storefront lives on, create the DNS record shown to prove you own it, then verify.
        </CardDescription>
        <CardAction>
          <NewDomainButton />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {data && !data.routing && (
          <p className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
            This install serves one shop on every address, so your storefront already answers on any domain that points
            here. Domains choose the shop per address when the server runs with{' '}
            <code className="font-mono text-xs">TENANCY_MODE=multi</code>.
          </p>
        )}
        <DataTable
          columns={columns}
          data={data?.domains}
          getRowId={(d) => d.id}
          isPending={isPending}
          error={error}
          empty="No domains yet."
        />
      </CardContent>
    </Card>
  )
}

function CopyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs">{value}</code>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value)
            toast.success('Copied')
          }}
        >
          <CopyIcon />
        </Button>
      </div>
    </div>
  )
}

function NewDomainButton() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  // After adding: the record to create
  const [added, setAdded] = useState<Domain | null>(null)
  const form = useZodForm(domainInput, { defaultValues: { domain: '' } })
  const create = useMutation(orpc.admin.domains.create.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      setAdded(await create.mutateAsync(values))
      await queryClient.invalidateQueries({ queryKey: orpc.admin.domains.key() })
      form.reset()
    } catch (error) {
      setServerError(form, error, { CONFLICT: 'domain', BAD_REQUEST: 'domain' })
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setAdded(null)
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <PlusIcon />
        Add domain
      </DialogTrigger>
      <DialogContent>
        {added ? (
          <>
            <DialogHeader>
              <DialogTitle>Verify {added.domain}</DialogTitle>
              <DialogDescription>
                Add this TXT record at your DNS provider, then press Verify on the domain. DNS changes can take a while
                to show up.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <CopyValue label="Type" value={added.record.type} />
              <CopyValue label="Name" value={added.record.name} />
              <CopyValue label="Value" value={added.record.value} />
            </div>
            <DialogFooter>
              <DialogClose render={<Button />}>Done</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add domain</DialogTitle>
              <DialogDescription>The address people will visit, like shop.example.com.</DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} noValidate>
              <FieldGroup>
                <TextField
                  control={form.control}
                  name="domain"
                  label="Domain"
                  placeholder="shop.example.com"
                  autoComplete="off"
                />
                <FormError form={form} />
                <Field orientation="horizontal" className="justify-end">
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? 'Adding…' : 'Add domain'}
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

function VerifyButton({ domain }: { domain: Domain }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const verify = useMutation(orpc.admin.domains.verify.mutationOptions())

  async function onVerify() {
    try {
      const result = await verify.mutateAsync({ id: domain.id })
      if (result.verified) {
        await queryClient.invalidateQueries({ queryKey: orpc.admin.domains.key() })
        toast.success(`${domain.domain} verified`)
        setOpen(false)
      } else {
        toast.error('We couldn’t find the TXT record yet. DNS changes can take a while; try again shortly.')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not verify domain')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Verify</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify {domain.domain}</DialogTitle>
          <DialogDescription>Create this TXT record at your DNS provider, then check it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <CopyValue label="Type" value={domain.record.type} />
          <CopyValue label="Name" value={domain.record.name} />
          <CopyValue label="Value" value={domain.record.value} />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Close</DialogClose>
          <Button onClick={onVerify} disabled={verify.isPending}>
            {verify.isPending ? 'Checking…' : 'Check record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDomainButton({ domain }: { domain: Domain }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const remove = useMutation(orpc.admin.domains.delete.mutationOptions())

  async function onDelete() {
    try {
      await remove.mutateAsync({ id: domain.id })
      await queryClient.invalidateQueries({ queryKey: orpc.admin.domains.key() })
      toast.success('Domain removed')
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove domain')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Remove</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {domain.domain}?</DialogTitle>
          <DialogDescription>
            {domain.verified
              ? 'In multi-shop mode the storefront stops responding on this address right away. You can add it again later, but will need to verify it again.'
              : 'The pending verification is discarded.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button variant="destructive" onClick={onDelete} disabled={remove.isPending}>
            {remove.isPending ? 'Removing…' : 'Remove domain'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
