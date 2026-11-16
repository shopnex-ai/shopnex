'use client'

// Online store → URL redirects: a path that has no page sends visitors to another URL (301). Renaming a product,
// collection or page adds its redirect by itself; this is where the rest are added, edited and imported.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { redirectInput } from '@shopnex/api/schemas'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { DeleteSelectedButton } from '@/components/admin/delete-selected-button'
import { FormError, TextField, setServerError, useZodForm } from '@/components/admin/form'
import { useListParams } from '@/components/admin/list-params'
import { PageHeader } from '@/components/admin/page-header'
import { SearchInput } from '@/components/admin/search-input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup } from '@/components/ui/field'
import { useOpenOnNew } from '@/hooks/use-open-on-new'
import { client, orpc, type Outputs } from '@/lib/orpc'
import { ImportRedirectsDialog } from './import-redirects'

type Redirect = Outputs['admin']['redirects']['list']['items'][number]

export function RedirectList() {
  const queryClient = useQueryClient()
  const { page, pageSize, search, range, setPage, setSearch } = useListParams()
  const { data, error, isPending } = useQuery({
    ...orpc.admin.redirects.list.queryOptions({ input: { ...range, search: search || undefined } }),
    placeholderData: keepPreviousData,
  })

  const col = columnHelper<Redirect>()
  const columns = [
    col.accessor('fromPath', {
      header: 'Old URL',
      cell: ({ getValue }) => <span className="font-mono text-sm">{getValue()}</span>,
    }),
    col.accessor('toPath', {
      header: 'Goes to',
      cell: ({ getValue }) => (
        <span className="flex items-center gap-2 font-mono text-sm text-muted-foreground">
          <ArrowRightIcon className="size-3.5 shrink-0" />
          <span className="break-all">{getValue()}</span>
        </span>
      ),
    }),
    col.display({
      id: 'actions',
      cell: ({ row: { original: r } }) => <RedirectDialog redirect={r} />,
      meta: { className: 'text-right' },
    }),
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="URL redirects"
        description="Send visitors from an old address to a new one. Renaming a product, collection or page adds its redirect by itself."
        actions={
          <div className="flex items-center gap-2">
            <ImportRedirectsDialog />
            <RedirectDialog />
          </div>
        }
      />
      <SearchInput value={search} onSearch={setSearch} placeholder="Search redirects" />
      <DataTable
        columns={columns}
        data={data?.items}
        getRowId={(r) => r.id}
        isPending={isPending}
        error={error}
        empty={search ? `No redirects match “${search}”.` : 'No redirects yet.'}
        pagination={{ page, pageSize, total: data?.total, onPageChange: setPage }}
        selectionActions={(ids, clearSelection) => (
          <DeleteSelectedButton
            ids={ids}
            entity={ids.length === 1 ? 'redirect' : 'redirects'}
            remove={(selected) => client.admin.redirects.deleteMany({ ids: selected })}
            onDeleted={async () => {
              clearSelection()
              await queryClient.invalidateQueries({ queryKey: orpc.admin.redirects.key() })
            }}
          />
        )}
      />
    </div>
  )
}

// Create when `redirect` is omitted, otherwise edit (or delete) it
function RedirectDialog({ redirect }: { redirect?: Redirect }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  useOpenOnNew(() => setOpen(true), !redirect)
  const values = { fromPath: redirect?.fromPath ?? '', toPath: redirect?.toPath ?? '' }
  const form = useZodForm(redirectInput, { defaultValues: values })
  const create = useMutation(orpc.admin.redirects.create.mutationOptions())
  const update = useMutation(orpc.admin.redirects.update.mutationOptions())
  const remove = useMutation(orpc.admin.redirects.delete.mutationOptions())
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.redirects.key() })

  const onSubmit = form.handleSubmit(async (input) => {
    try {
      if (redirect) await update.mutateAsync({ id: redirect.id, ...input })
      else await create.mutateAsync(input)
      await refresh()
      toast.success(redirect ? 'Redirect saved' : 'Redirect created')
      setOpen(false)
    } catch (error) {
      setServerError(form, error, { CONFLICT: 'fromPath', BAD_REQUEST: 'fromPath' })
    }
  })

  async function onDelete() {
    try {
      await remove.mutateAsync({ id: redirect!.id })
      await refresh()
      toast.success('Redirect deleted')
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
        if (next) form.reset(values)
      }}
    >
      <DialogTrigger render={<Button variant={redirect ? 'ghost' : 'default'} size="sm" />}>
        {redirect ? (
          'Edit'
        ) : (
          <>
            <PlusIcon />
            Add redirect
          </>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{redirect ? 'Edit redirect' : 'Add redirect'}</DialogTitle>
          <DialogDescription>
            A visitor who opens the old URL on your store, where there is no page, is sent to the new one.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField
              control={form.control}
              name="fromPath"
              label="Old URL"
              placeholder="/products/old-name"
              autoComplete="off"
              description="A path on your store, starting with /."
            />
            <TextField
              control={form.control}
              name="toPath"
              label="New URL"
              placeholder="/products/new-name"
              autoComplete="off"
              description="A path on your store, or a full address starting with https://."
            />
            <FormError form={form} />
            <Field orientation="horizontal" className="justify-between">
              {redirect ? (
                <Button type="button" variant="ghost" onClick={onDelete} disabled={remove.isPending}>
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving…' : redirect ? 'Save' : 'Add redirect'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}
