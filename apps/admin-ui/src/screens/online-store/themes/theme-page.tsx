import { useLoaderData } from '@tanstack/react-router'
import { CurrentTheme } from './current-theme'
import { Page } from '@/components/admin/page'

export function ThemePage() {
  const { storefront, storefrontError } = useLoaderData({ from: '/admin/online-store/' })
  return (
    <Page>
      <CurrentTheme storefront={storefront} storefrontError={storefrontError} />
    </Page>
  )
}
