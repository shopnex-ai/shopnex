import { createFileRoute } from '@tanstack/react-router'
import { loadStorefront } from '@/screens/online-store/themes/theme-functions'
import { ThemePage } from '@/screens/online-store/themes/theme-page'

export const Route = createFileRoute('/admin/online-store/')({
  loader: () => loadStorefront(),
  component: ThemePage,
})
