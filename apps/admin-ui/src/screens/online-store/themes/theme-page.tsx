import { useLoaderData } from '@tanstack/react-router'
import { CurrentTheme } from './current-theme'

export function ThemePage() {
  const { storefront, storefrontError } = useLoaderData({ from: '/admin/online-store/themes' })
  return (
    <div className="mx-auto max-w-4xl">
      <CurrentTheme storefront={storefront} storefrontError={storefrontError} />
    </div>
  )
}
