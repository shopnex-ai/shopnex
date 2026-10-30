type LogoProps = { className?: string }

export function ShopifyLogo({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path
        fill="#95BF47"
        d="m8.1 8.8 2.3-2.7a5.7 5.7 0 0 1 11.1.2l2.4.6 2.2 21.7H5.8L8.1 8.8Zm4.1-.1 7.8 1.8a3.5 3.5 0 0 0-7-1.8l-.8 0Zm1.1-1.3a2.3 2.3 0 0 1 4.5 1l-4.5-1Z"
      />
      <path
        fill="#fff"
        d="M18.8 13.1c-.6-.6-1.6-1-2.8-1-2.4 0-4.1 1.5-4.1 3.5 0 1.6 1.2 2.4 2.8 3.1 1.1.5 1.6.8 1.6 1.4 0 .5-.5.9-1.3.9-.9 0-2-.4-2.8-1l-.8 2.6c.8.6 2.2 1 3.6 1 2.7 0 4.4-1.4 4.4-3.6 0-1.6-.9-2.5-2.7-3.3-1.2-.5-1.7-.8-1.7-1.3 0-.5.5-.8 1.2-.8.9 0 1.7.3 2.2.7l.7-2.2Z"
      />
    </svg>
  )
}

export function WooCommerceLogo({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path fill="#96588A" d="M5 4h22a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3h-9l-7 5v-5H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" />
      <text
        x="16"
        y="18.5"
        fill="#fff"
        fontFamily="Arial,sans-serif"
        fontSize="10"
        fontWeight="700"
        textAnchor="middle"
      >
        woo
      </text>
    </svg>
  )
}

export function MagentoLogo({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#EE672F"
        d="M12 24 7.545 21.428v-12l2.97-1.715v12.001L12 20.616l1.485-.902V7.713l2.971 1.715v12L12 24Zm10.391-6V6L12 0 1.609 6v12l2.965 1.714V7.713L12 3.43l7.422 4.283v12.001L22.391 18Z"
      />
    </svg>
  )
}
