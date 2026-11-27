import { useLoaderData } from '@tanstack/react-router'
import { CurrentTheme } from './current-theme'
import { ThemePicker } from './select/theme-picker'
import { Page } from '@/components/admin/page'

export function ThemePage() {
  const { storefront, storefrontError } = useLoaderData({ from: '/admin/online-store/' })
  return (
    <Page>
      <div className="space-y-4">
        <CurrentTheme storefront={storefront} storefrontError={storefrontError} />
        <ThemePicker storefront={storefront} />
      </div>
    </Page>
  )
}
