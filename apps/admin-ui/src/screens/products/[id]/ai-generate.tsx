'use client'

// ✨ Generate: asks an AI app installed in the shop (Apps) for a suggestion. "Use" puts it into the product form
// as an unsaved change, so nothing is saved until staff press Save. Hidden when no app provides the capability.
import { useMutation, useQuery } from '@tanstack/react-query'
import { SparklesIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { AI_LENGTHS, AI_TONES, aiCapabilities, type AiCapability, type AiOutput } from '@shopnex/api/schemas'
import { SelectField, TextareaField, useZodForm } from '@/components/admin/form'
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

const label = (value: string) => value[0]!.toUpperCase() + value.slice(1)
const options = (values: readonly string[]) => values.map((value) => ({ value, label: label(value) }))

function useAiApps(capability: AiCapability) {
  const capabilities = useQuery({ ...orpc.admin.ai.capabilities.queryOptions(), staleTime: 60_000 })
  return capabilities.data?.find((c) => c.capability === capability)?.apps ?? []
}

type Generated<C extends AiCapability> = { id: string; app: { name: string }; output: AiOutput<C> }

function AiDialog<C extends AiCapability>({
  capability,
  productId,
  title,
  description,
  fields,
  input,
  preview,
  onUse,
}: {
  capability: C
  productId: string
  title: string
  description: string
  /** The capability's options (a form the caller owns) */
  fields?: ReactNode
  /** The options, validated; null when they aren't valid */
  input: () => Promise<object | null>
  preview: (output: AiOutput<C>) => ReactNode
  onUse: (output: AiOutput<C>) => void
}) {
  const apps = useAiApps(capability)
  const [open, setOpen] = useState(false)
  const [appId, setAppId] = useState<string | null>(null)
  const [result, setResult] = useState<Generated<C> | null>(null)
  const run = useMutation(orpc.admin.ai.run.mutationOptions())
  const feedback = useMutation(orpc.admin.ai.feedback.mutationOptions())

  if (apps.length === 0) return null
  const app = apps.find((a) => a.id === appId) ?? apps[0]!

  const generate = async () => {
    const values = await input()
    if (!values) return
    try {
      const generated = await run.mutateAsync({
        capability,
        productId,
        appId: app.id,
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
        Generate
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border p-3 text-sm">
            {preview(result.output)}
            <p className="text-xs text-muted-foreground">By {result.app.name}. Review it before saving.</p>
          </div>
        ) : (
          <FieldGroup>
            {apps.length > 1 && (
              <Field>
                <FieldLabel>App</FieldLabel>
                <Select
                  items={apps.map((a) => ({ value: a.id, label: a.name }))}
                  value={app.id}
                  onValueChange={(value) => setAppId(value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {apps.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
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

const descriptionInput = aiCapabilities['product.description'].input

export function GenerateDescription({
  productId,
  onUse,
}: {
  productId: string
  onUse: (descriptionHtml: string) => void
}) {
  const form = useZodForm(descriptionInput, { defaultValues: { tone: 'neutral', length: 'medium', instructions: '' } })
  return (
    <AiDialog
      capability="product.description"
      productId={productId}
      title="Generate a description"
      description="Written from the product's title, options, tags and current description."
      input={() => new Promise((resolve) => void form.handleSubmit(resolve, () => resolve(null))())}
      fields={
        <>
          <div className="grid grid-cols-2 gap-4">
            <SelectField control={form.control} name="tone" label="Tone" options={options(AI_TONES)} />
            <SelectField control={form.control} name="length" label="Length" options={options(AI_LENGTHS)} />
          </div>
          <TextareaField
            control={form.control}
            name="instructions"
            label="Instructions"
            description="Optional, e.g. “mention it’s machine washable”"
            rows={2}
          />
        </>
      }
      // Sanitized by Shopnex before it gets here
      preview={(output) => (
        <div className="prose prose-sm" dangerouslySetInnerHTML={{ __html: output.descriptionHtml }} />
      )}
      onUse={(output) => onUse(output.descriptionHtml)}
    />
  )
}

const seoInput = aiCapabilities['product.seo'].input

export function GenerateSeo({
  productId,
  onUse,
}: {
  productId: string
  onUse: (seo: { title: string; description: string }) => void
}) {
  const form = useZodForm(seoInput, { defaultValues: { instructions: '' } })
  return (
    <AiDialog
      capability="product.seo"
      productId={productId}
      title="Generate a search listing"
      description="A page title and meta description for search engines."
      input={() => new Promise((resolve) => void form.handleSubmit(resolve, () => resolve(null))())}
      fields={
        <TextareaField
          control={form.control}
          name="instructions"
          label="Instructions"
          description="Optional, e.g. “target ‘linen summer dress’”"
          rows={2}
        />
      }
      preview={(output) => (
        <div className="space-y-1">
          <p className="font-medium text-primary">{output.title}</p>
          <p className="text-muted-foreground">{output.description}</p>
        </div>
      )}
      onUse={onUse}
    />
  )
}
