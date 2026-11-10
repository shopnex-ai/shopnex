import pc from 'picocolors'

// The admin's brand green in its dark theme (apps/admin-ui/src/styles.css: --brand oklch(0.72 0.15 155), with
// --brand-foreground oklch(0.18 0.03 155) on it), as sRGB. Terminals are mostly dark, so the dark variant.
const BRAND = [67, 192, 122] as const
const ON_BRAND = [6, 21, 12] as const

const truecolor = pc.isColorSupported && /^(truecolor|24bit)$/i.test(process.env.COLORTERM ?? '')

/** The brand green as text. Terminals without 24-bit colour get the nearest named green */
export const brand = (text: string) => (truecolor ? `\x1b[38;2;${BRAND.join(';')}m${text}\x1b[39m` : pc.green(text))

/** Dark text on a brand green background: the banner */
export const brandBadge = (text: string) =>
  truecolor
    ? `\x1b[48;2;${BRAND.join(';')}m\x1b[38;2;${ON_BRAND.join(';')}m${text}\x1b[39m\x1b[49m`
    : pc.bgGreen(pc.black(text))
