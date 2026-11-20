import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GiftIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { giftCardIssueInput } from '@shopnex/gift-cards/contract'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { DateTimeField, FormError, MoneyField, TextField, setServerError, useZodForm } from '@/components/admin/form'
import { EmptyState } from '@/components/admin/empty-state'
import { PageHeader } from '@/components/admin/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Field, FieldGroup } from '@/components/ui/field'
import { formatDate } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import { useOpenOnNew } from '@/hooks/use-open-on-new'
import { orpc, type Outputs } from '@/lib/orpc'

type GiftCard = Outputs['admin']['giftCards']['list'][number]

// "ABCDEFGHJKMNPQRS" → "ABCD-EFGH-JKMN-PQRS"
const formatCode = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-')

function status(card: GiftCard): { label: string; variant: 'default' | 'secondary' | 'outline' } {
  if (!card.active) return { label: 'Disabled', variant: 'outline' }
  if (card.expiresAt && new Date(card.expiresAt) <= new Date()) return { label: 'Expired', variant: 'outline' }
  if (card.balanceCents <= 0) return { label: 'Used up', variant: 'outline' }
  return { label: 'Active', variant: 'default' }
}

export function GiftCardList({ currency }: { currency: string }) {
  const { data, error, isPending } = useQuery(orpc.admin.giftCards.list.queryOptions())
  const money = (cents: number) => formatMoney(cents, currency)

  const col = columnHelper<GiftCard>()
  const columns = [
    col.accessor('code', {
      header: 'Code',
      cell: ({ row: { original: card } }) => {
        const s = status(card)
        return (
          <span className="flex items-center gap-2">
            <span className="font-mono font-medium">{formatCode(card.code)}</span>
            <Badge variant={s.variant}>{s.label}</Badge>
          </span>
        )
      },
    }),
    col.accessor('balanceCents', {
      header: 'Balance',
      cell: ({ row: { original: card } }) => (
        <span className="tabular-nums">
          {money(card.balanceCents)} <span className="text-muted-foreground">of {money(card.initialCents)}</span>
        </span>
      ),
    }),
    col.display({
      id: 'recipient',
      header: 'For',
      cell: ({ row: { original: card } }) => card.recipientEmail ?? '',
    }),
    col.accessor('createdAt', { header: 'Issued', cell: ({ getValue }) => formatDate(getValue()) }),
    col.display({
      id: 'actions',
      cell: ({ row: { original: card } }) => <GiftCardDialog card={card} currency={currency} />,
      meta: { className: 'text-right' },
    }),
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="Gift cards" actions={<IssueDialog currency={currency} />} />
      <DataTable
        columns={columns}
        data={data}
        getRowId={(card) => card.id}
        isPending={isPending}
        error={error}
        blank={
          <EmptyState icon={GiftIcon} title="Issue your first gift card" action={<IssueDialog currency={currency} />}>
            Buyers pay with the code at checkout.
          </EmptyState>
        }
      />
    </div>
  )
}

function IssueDialog({ currency }: { currency: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  useOpenOnNew(() => setOpen(true), true)
  const form = useZodForm(giftCardIssueInput, {
    defaultValues: { amountCents: undefined as unknown as number, recipientEmail: null, expiresAt: null, note: null },
  })
  const issue = useMutation(orpc.admin.giftCards.issue.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const card = await issue.mutateAsync(values)
      await queryClient.invalidateQueries({ queryKey: orpc.admin.giftCards.key() })
      toast.success(`Gift card ${formatCode(card.code)} issued`)
      setOpen(false)
    } catch (error) {
      setServerError(form, error)
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) form.reset()
      }}
    >
      <DialogTrigger render={<Button />}>
        <PlusIcon />
        Issue gift card
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue gift card</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <MoneyField control={form.control} name="amountCents" label="Amount" currency={currency} />
            <TextField
              control={form.control}
              name="recipientEmail"
              label="For (optional)"
              type="email"
              placeholder="friend@example.com"
              nullable
            />
            <DateTimeField control={form.control} name="expiresAt" label="Expires (optional)" />
            <TextField control={form.control} name="note" label="Note (optional)" nullable />
            <FormError form={form} />
            <Field orientation="horizontal" className="justify-end">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Issuing…' : 'Issue gift card'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// The card's history, and switching it off or on
function GiftCardDialog({ card, currency }: { card: GiftCard; currency: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const detail = useQuery({ ...orpc.admin.giftCards.get.queryOptions({ input: { id: card.id } }), enabled: open })
  const disable = useMutation(orpc.admin.giftCards.disable.mutationOptions())
  const enable = useMutation(orpc.admin.giftCards.enable.mutationOptions())
  const money = (cents: number) => formatMoney(cents, currency)

  async function toggle() {
    try {
      if (card.active) await disable.mutateAsync({ id: card.id })
      else await enable.mutateAsync({ id: card.id })
      await queryClient.invalidateQueries({ queryKey: orpc.admin.giftCards.key() })
      toast.success(card.active ? 'Gift card disabled' : 'Gift card enabled')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change the gift card')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>View</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono">{formatCode(card.code)}</DialogTitle>
        </DialogHeader>
        <div className="text-2xl font-semibold tabular-nums">{money(card.balanceCents)}</div>
        <ul className="divide-y text-sm">
          {detail.data?.transactions
            .slice()
            .reverse()
            .map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2">
                <span className="capitalize">
                  {t.kind}
                  <span className="text-muted-foreground"> · {formatDate(t.createdAt)}</span>
                </span>
                <span className="tabular-nums">
                  {t.amountCents > 0 ? '+' : ''}
                  {money(t.amountCents)}
                </span>
              </li>
            ))}
        </ul>
        <Field orientation="horizontal" className="justify-end">
          <Button variant="outline" onClick={toggle} disabled={disable.isPending || enable.isPending}>
            {card.active ? 'Disable' : 'Enable'}
          </Button>
        </Field>
      </DialogContent>
    </Dialog>
  )
}
