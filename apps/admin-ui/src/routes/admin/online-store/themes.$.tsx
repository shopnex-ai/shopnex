import { createFileRoute, redirect } from '@tanstack/react-router'

// The theme pages used to live under /online-store/themes; old links and bookmarks land on their new place
export const Route = createFileRoute('/admin/online-store/themes/$')({
  beforeLoad: ({ params }) => {
    const [first, ...rest] = (params._splat ?? '').split('/').filter(Boolean)
    if (!first) throw redirect({ to: '/admin/online-store' })
    if (first === 'select') throw redirect({ to: '/admin/online-store/select' })
    if (rest[0] === 'code') throw redirect({ to: '/admin/online-store/editor/$id/code', params: { id: first } })
    throw redirect({ to: '/admin/online-store/editor/$id', params: { id: first } })
  },
})
