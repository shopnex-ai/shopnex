// Image types we accept, recognized from their first bytes (never from the client's Content-Type or file
// name). No SVG: files are served from the admin's origin, and an SVG can carry script.
export const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
} as const

export type ImageType = keyof typeof IMAGE_TYPES

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))

export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png'
  if (['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) return 'image/gif'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp'
  if (ascii(bytes, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(bytes, 8, 12))) return 'image/avif'
  return null
}

/** Content type for a key we generated ({shopId}/{id}.{ext}) */
export function typeOfKey(key: string): ImageType | null {
  const ext = key.slice(key.lastIndexOf('.') + 1)
  const entry = Object.entries(IMAGE_TYPES).find(([, e]) => e === ext)
  return (entry?.[0] as ImageType | undefined) ?? null
}
