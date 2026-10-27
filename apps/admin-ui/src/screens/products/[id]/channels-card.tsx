'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChannelPicker } from '@/components/admin/channel-picker'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { orpc } from '@/lib/orpc'

export function ProductChannelsCard({ productId }: { productId: string }) {
  const queryClient = useQueryClient()
  const publications = useQuery(orpc.admin.products.publications.queryOptions({ input: { id: productId } }))
  const save = useMutation(orpc.admin.products.setPublications.mutationOptions())

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales channels</CardTitle>
        <CardDescription>
          Where this product is sold. Only active products show, on the channels checked.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChannelPicker
          publications={publications.data}
          isPending={publications.isPending}
          saving={save.isPending}
          onSave={async (channelIds) => {
            try {
              await save.mutateAsync({ id: productId, publications: channelIds.map((channelId) => ({ channelId })) })
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: orpc.admin.products.publications.key() }),
                queryClient.invalidateQueries({ queryKey: orpc.admin.products.list.key() }),
              ])
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Could not save sales channels')
            }
          }}
        />
      </CardContent>
    </Card>
  )
}
