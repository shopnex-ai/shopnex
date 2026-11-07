import { createFileRoute } from '@tanstack/react-router'
import { ThemePickerPage } from '@/screens/online-store/themes/theme-picker-page'
import { loadStorefront } from '@/screens/online-store/themes/theme-functions'

export const Route = createFileRoute('/admin/online-store/themes/select')({
  loader: () => loadStorefront(),
  component: ThemePickerPage,
})
