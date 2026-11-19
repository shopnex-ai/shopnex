import { useLoaderData } from '@tanstack/react-router'
import { ThemePicker } from './select/theme-picker'
import { Page } from '@/components/admin/page'

export function ThemePickerPage() {
  const { storefront, storefrontError } = useLoaderData({ from: '/admin/online-store/select' })
  return (
    <Page>
      <ThemePicker storefront={storefront} storefrontError={storefrontError} />
    </Page>
  )
}
