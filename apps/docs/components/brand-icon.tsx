import type { SimpleIcon } from 'simple-icons'

// A brand logo from simple-icons. Near-black brands (Render, Railway) use currentColor so they stay visible on the dark theme.
export function BrandIcon({ icon, brand = true }: { icon: SimpleIcon; brand?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label={icon.title} fill={brand ? `#${icon.hex}` : 'currentColor'}>
      <path d={icon.path} />
    </svg>
  )
}
