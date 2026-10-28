'use client'

// ✨ Generate: asks the shop's AI (Settings → AI, or an installed AI app) for a suggestion. "Use" puts it into the form
// as an unsaved change (or applies it, where the thing saves on its own), so nothing is saved until staff decide.
// Hidden when no app provides the capability.
import { useMutation, useQuery } from '@tanstack/react-query'
import { SparklesIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import type { AiCapability, AiOutput } from '@shopnex/api/schemas'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { orpc } from '@/lib/orpc'

export const label = (value: string) => value[0]!.toUpperCase() + value.slice(1)
export const options = (values: readonly string[]) => values.map((value) => ({ value, label: label(value) }))

export function useAiProviders(capability: AiCapability) {
  const capabilities = useQuery({ ...orpc.admin.ai.capabilities.queryOptions(), staleTime: 60_000 })
  return capabilities.data?.find((c) => c.capability === capability)?.providers ?? []
}

type Generated<C extends AiCapability> = { id: string; provider: { name: string }; output: AiOutput<C> }

export function AiDialog<C extends AiCapability>({
  capability,
  subject,
  title,
  trigger = 'Generate',
  description,
  fields,
  input,
  preview,
  onUse,
}: {
  capability: C
  /** What it is about: { productId }, { collectionId } or { pageId } */
  subject: Record<string, string | undefined>
  title: string
  /** The button that opens the dialog */
  trigger?: string
  description: string
  /** The capability's options (a form the caller owns) */
  fields?: ReactNode
  /** The options, validated; null when they aren't valid */
  input: () => Promise<object | null>
  preview: (output: AiOutput<C>) => ReactNode
  onUse: (output: AiOutput<C>) => void
}) {
  const providers = useAiProviders(capability)
  const [open, setOpen] = useState(false)
  const [providerId, setProviderId] = useState<string | null>(null)
  const [result, setResult] = useState<Generated<C> | null>(null)
  const run = useMutation(orpc.admin.ai.run.mutationOptions())
  const feedback = useMutation(orpc.admin.ai.feedback.mutationOptions())

  if (providers.length === 0) return null
  const provider = providers.find((p) => p.id === providerId) ?? providers[0]!

  const generate = async () => {
    const values = await input()
    if (!values) return
    try {
      const generated = await run.mutateAsync({
        capability,
        ...subject,
        providerId: provider.id,
        input: values,
      } as Parameters<typeof run.mutateAsync>[0])
      // The output matches the capability asked for (the API checks it against that capability's schema)
      setResult(generated as unknown as Generated<C>)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not generate')
    }
  }

  // Feedback is best effort: it never gets in the way of editing
  const close = (used: boolean) => {
    if (result) feedback.mutate({ id: result.id, feedback: used ? 'accepted' : 'rejected' })
    setResult(null)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close(false))}>
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" />}>
        <SparklesIcon />
        {trigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border p-3 text-sm">
            {preview(result.output)}
            <p className="text-xs text-muted-foreground">By {result.provider.name}. Review it before saving.</p>
          </div>
        ) : (
          <FieldGroup>
            {providers.length > 1 && (
              <Field>
                <FieldLabel>Provider</FieldLabel>
                <Select
                  items={providers.map((p) => ({ value: p.id, label: p.name }))}
                  value={provider.id}
                  onValueChange={(value) => setProviderId(value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {fields}
          </FieldGroup>
        )}
        <DialogFooter>
          {result ? (
            <>
              <Button type="button" variant="ghost" onClick={generate} disabled={run.isPending}>
                {run.isPending ? 'Generating…' : 'Try again'}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onUse(result.output)
                  close(true)
                }}
              >
                Use this
              </Button>
            </>
          ) : (
            <Button type="button" onClick={generate} disabled={run.isPending}>
              <SparklesIcon />
              {run.isPending ? 'Generating…' : 'Generate'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
