import type { ReactNode } from 'react'
import { cn } from 'cn'

const widths = {
  /** Forms and settings */
  narrow: 'max-w-3xl',
  /** Lists and detail pages */
  default: 'max-w-5xl min-[1600px]:max-w-6xl min-[2000px]:max-w-7xl',
  /** Pages with a side column, like the product editor */
  wide: 'max-w-6xl min-[1600px]:max-w-7xl min-[2000px]:max-w-[90rem]',
} as const

/** The root of every admin page: one width per kind of page and one gap between its blocks */
export function Page({
  width = 'default',
  className,
  children,
}: {
  width?: keyof typeof widths
  className?: string
  children: ReactNode
}) {
  return <div className={cn('mx-auto w-full space-y-4', widths[width], className)}>{children}</div>
}
