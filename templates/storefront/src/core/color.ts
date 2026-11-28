// Colour maths for the color_* Liquid filters (color_lighten, color_darken, color_brightness). Colours are written the way
// a theme setting stores them: #rgb, #rrggbb, rgb(r, g, b) or rgba(r, g, b, a). Anything else is left alone by the filters.

export type Rgba = { r: number; g: number; b: number; a: number; format: 'hex' | 'rgb' | 'rgba' }

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function parseColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!
    const n = parseInt(digits, 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1, format: 'hex' }
  }
  const fn = /^(rgba?)\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/.exec(text)
  if (fn) {
    const channels = [fn[2], fn[3], fn[4]].map(Number)
    if (channels.some((c) => c > 255)) return null
    return {
      r: channels[0]!,
      g: channels[1]!,
      b: channels[2]!,
      a: fn[5] === undefined ? 1 : clamp(Number(fn[5]), 0, 1),
      format: fn[1] === 'rgba' ? 'rgba' : 'rgb',
    }
  }
  return null
}

export function formatColor({ r, g, b, a, format }: Rgba): string {
  if (format === 'hex') return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
  return format === 'rgba' ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r}, ${g}, ${b})`
}

function toHsl({ r, g, b }: Rgba): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return [h * 60, s, l]
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

/** Moves the colour's lightness by `percent` points (negative darkens); the same notation comes back. Not a colour: unchanged. */
export function shiftLightness(value: string, percent: number): string {
  const color = parseColor(value)
  if (!color || !Number.isFinite(percent)) return value
  const [h, s, l] = toHsl(color)
  const [r, g, b] = fromHsl(h, s, clamp(l + percent / 100, 0, 1))
  return formatColor({ ...color, r, g, b })
}

/** How bright the eye finds a colour, 0 (black) to 255 (white), by the W3C formula. Not a colour: 0. */
export function brightness(value: string): number {
  const color = parseColor(value)
  return color ? (color.r * 299 + color.g * 587 + color.b * 114) / 1000 : 0
}
