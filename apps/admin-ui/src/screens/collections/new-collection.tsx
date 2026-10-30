'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { FormError, setServerError } from '@/components/admin/form'
import { PageHeader } from '@/components/admin/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { orpc } from '@/lib/orpc'
import { CollectionFields, useCollectionForm } from './collection-fields'

export function NewCollection() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const form = useCollectionForm({ title: '', slug: undefined, description: null })
  const create = useMutation(orpc.admin.collections.create.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const created = await create.mutateAsync(values)
      await queryClient.invalidateQueries({ queryKey: orpc.admin.collections.key() })
      toast.success('Collection created')
      // Products are added on its page
      await navigate({ to: '/admin/collections/$id', params: { id: created.id } })
    } catch (error) {
      setServerError(form, error, { CONFLICT: 'slug' })
    }
  })

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: '/admin/collections', label: 'Collections' }}
        title="Create collection"
        description="Add products to it once it is created."
      />
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <Card>
          <CardContent className="space-y-4">
            <CollectionFields control={form.control} isNew />
            <FormError form={form} />
          </CardContent>
        </Card>
        <div className="flex justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Creating…' : 'Create collection'}
          </Button>
        </div>
      </form>
    </div>
  )
}
