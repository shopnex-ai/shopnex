import { ShopnexLoader } from '@/components/admin/shopnex-logo'
import { cn } from '@/lib/utils'

// Shown over a storefront preview that is still loading: the ShopNex mark drawing itself, centered.
// Fills its positioned parent.
export function PreviewLoader({ className, logoClassName }: { className?: string; logoClassName?: string }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 flex items-center justify-center bg-background text-muted-foreground',
        className,
      )}
    >
      <ShopnexLoader className={cn('size-14', logoClassName)} />
    </div>
  )
}
