'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PackagePlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { orpc } from '@/lib/orpc'

// For an empty shop: a few demo products to try the admin and the storefront with
export function AddSamplesButton() {
  const queryClient = useQueryClient()
  const add = useMutation(orpc.admin.products.addSamples.mutationOptions())

  return (
    <Button
      variant="outline"
      disabled={add.isPending}
      onClick={async () => {
        try {
          await add.mutateAsync({})
          await queryClient.invalidateQueries({ queryKey: orpc.admin.products.key() })
          toast.success('Sample products added')
        } catch {
          toast.error('Could not add the sample products')
        }
      }}
    >
      <PackagePlusIcon />
      {add.isPending ? 'Adding…' : 'Add sample products'}
    </Button>
  )
}
