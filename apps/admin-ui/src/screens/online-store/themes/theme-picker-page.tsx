import { useLoaderData } from '@tanstack/react-router'
import { ThemePicker } from './select/theme-picker'

export function ThemePickerPage() {
  const { storefront, storefrontError } = useLoaderData({ from: '/admin/online-store/themes/select' })
  return (
    <div className="mx-auto max-w-4xl">
      <ThemePicker storefront={storefront} storefrontError={storefrontError} />
    </div>
  )
}
