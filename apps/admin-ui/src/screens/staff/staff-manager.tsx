'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CopyIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { staffInviteInput } from '@shopnex/api/schemas'
import { INVITATION_EXPIRES_IN_DAYS } from '@shopnex/auth/roles'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { FormError, SelectField, TextField, setServerError, useZodForm } from '@/components/admin/form'
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
import { Input } from '@/components/ui/input'
import { formatDate } from '@/lib/format'
import { orpc, type Outputs } from '@/lib/orpc'

type Member = Outputs['admin']['staff']['list']['members'][number]
type Invitation = Outputs['admin']['staff']['list']['invitations'][number]

const roleLabel: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Staff' }

const ADMIN_OPTION = { value: 'admin', label: 'Admin — everything, including settings and staff' }
const STAFF_OPTION = { value: 'member', label: 'Staff — products, orders and customers' }

const inviteLink = (id: string) => `${window.location.origin}/admin/invite/${id}`

async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  toast.success('Link copied')
}

/** canManageAdmins: owners and super admins; plain admins manage staff only */
export function StaffManager({ currentUserId, canManageAdmins }: { currentUserId: string; canManageAdmins: boolean }) {
  const queryClient = useQueryClient()
  const { data, error, isPending } = useQuery(orpc.admin.staff.list.queryOptions())
  const updateRole = useMutation(orpc.admin.staff.updateRole.mutationOptions())
  const remove = useMutation(orpc.admin.staff.remove.mutationOptions())
  const cancel = useMutation(orpc.admin.staff.cancelInvitation.mutationOptions())

  async function run(action: Promise<unknown>, success: string) {
    try {
      await action
      await queryClient.invalidateQueries({ queryKey: orpc.admin.staff.key() })
      toast.success(success)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong')
    }
  }

  // Mirrors the server rule (tenancy/staff.ts), which has the final say
  const editable = (m: Member) =>
    m.userId !== currentUserId && m.role !== 'owner' && (m.role !== 'admin' || canManageAdmins)

  const memberCol = columnHelper<Member>()
  const memberColumns = [
    memberCol.accessor('name', {
      header: 'Name',
      cell: ({ row: { original: m } }) => (
        <div>
          <div className="font-medium">
            {m.name || m.email}
            {m.userId === currentUserId && <span className="text-muted-foreground"> (you)</span>}
          </div>
          {m.name && <div className="text-xs text-muted-foreground">{m.email}</div>}
        </div>
      ),
    }),
    memberCol.accessor('role', {
      header: 'Role',
      cell: ({ row: { original: m } }) =>
        editable(m) && canManageAdmins ? (
          <select
            value={m.role}
            aria-label={`Role of ${m.name || m.email}`}
            className="h-7 rounded-md border bg-background px-2 text-sm"
            onChange={(e) =>
              run(updateRole.mutateAsync({ id: m.id, role: e.target.value as 'admin' | 'member' }), 'Role updated')
            }
          >
            <option value="admin">Admin</option>
            <option value="member">Staff</option>
          </select>
        ) : (
          <Badge variant={m.role === 'owner' ? 'default' : 'secondary'}>{roleLabel[m.role] ?? m.role}</Badge>
        ),
    }),
    memberCol.display({
      id: 'actions',
      cell: ({ row: { original: m } }) =>
        editable(m) ? (
          <RemoveMemberButton
            name={m.name || m.email}
            onConfirm={() => run(remove.mutateAsync({ id: m.id }), 'Removed from shop')}
          />
        ) : null,
      meta: { className: 'text-right' },
    }),
  ]

  const inviteCol = columnHelper<Invitation>()
  const invitationColumns = [
    inviteCol.accessor('email', { header: 'Email' }),
    inviteCol.accessor('role', { header: 'Role', cell: (c) => roleLabel[c.getValue() ?? 'member'] ?? c.getValue() }),
    inviteCol.accessor('expiresAt', { header: 'Expires', cell: (c) => formatDate(c.getValue()) }),
    inviteCol.display({
      id: 'actions',
      cell: ({ row: { original: i } }) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => copy(inviteLink(i.id))}>
            <CopyIcon />
            Copy link
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => run(cancel.mutateAsync({ id: i.id }), 'Invitation cancelled')}
          >
            Cancel
          </Button>
        </div>
      ),
      meta: { className: 'text-right' },
    }),
  ]

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardAction>
            <InviteButton canInviteAdmins={canManageAdmins} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={memberColumns}
            data={data?.members}
            getRowId={(m) => m.id}
            isPending={isPending}
            error={error}
            empty="No members yet. Invite someone to get started."
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
          <CardDescription>
            Send the invite link to the person you invited. Links expire after {INVITATION_EXPIRES_IN_DAYS} days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={invitationColumns}
            data={data?.invitations}
            getRowId={(i) => i.id}
            isPending={isPending}
            error={error}
            empty="No pending invitations."
          />
        </CardContent>
      </Card>
    </>
  )
}

function InviteButton({ canInviteAdmins }: { canInviteAdmins: boolean }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const form = useZodForm(staffInviteInput, { defaultValues: { email: '', role: 'member' } })
  const invite = useMutation(orpc.admin.staff.invite.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const invitation = await invite.mutateAsync(values)
      await queryClient.invalidateQueries({ queryKey: orpc.admin.staff.key() })
      setLink(inviteLink(invitation.id))
    } catch (error) {
      setServerError(form, error, { CONFLICT: 'email' })
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setLink(null)
          form.reset()
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <PlusIcon />
        Invite
      </DialogTrigger>
      <DialogContent>
        {link ? (
          <>
            <DialogHeader>
              <DialogTitle>Invitation created</DialogTitle>
              <DialogDescription>
                Send this link to {form.getValues('email')}. They&apos;ll create their account (or sign in) and join the
                shop.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
              <Button onClick={() => copy(link)}>
                <CopyIcon />
                Copy
              </Button>
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>Done</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Invite staff</DialogTitle>
              <DialogDescription>You&apos;ll get a link to send them.</DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} noValidate>
              <FieldGroup>
                <TextField control={form.control} name="email" label="Email" type="email" autoComplete="off" />
                <SelectField
                  control={form.control}
                  name="role"
                  label="Role"
                  options={canInviteAdmins ? [ADMIN_OPTION, STAFF_OPTION] : [STAFF_OPTION]}
                />
                <FormError form={form} />
                <Field orientation="horizontal" className="justify-end">
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    {form.formState.isSubmitting ? 'Inviting…' : 'Create invitation'}
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

function RemoveMemberButton({ name, onConfirm }: { name: string; onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Remove</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {name}?</DialogTitle>
          <DialogDescription>They lose access to this shop&apos;s admin. Their account is kept.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              setPending(true)
              await onConfirm()
              setPending(false)
              setOpen(false)
            }}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
