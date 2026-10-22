import sanitize from 'sanitize-html'

// Merchant HTML is rendered raw by storefront themes: strip scripts, event handlers,
// javascript: URLs etc. on write. Allows common formatting tags plus images.
export function sanitizeHtml(html: string): string {
  return sanitize(html, {
    allowedTags: [...sanitize.defaults.allowedTags, 'img'],
    allowedAttributes: { ...sanitize.defaults.allowedAttributes, img: ['src', 'alt', 'width', 'height'] },
    allowedSchemes: ['http', 'https', 'mailto'],
  }).trim()
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]!)

// Plain text from HTML (for `description` when only HTML was given)
// Block-level tags become spaces first, so "<p>a</p><p>b</p>" reads "a b", not "ab"
const BLOCK_TAGS = /<\/?(?:p|div|br|li|ul|ol|h[1-6]|tr|td|th|blockquote|section|article)\b[^>]*>/gi

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

// sanitize-html returns escaped text; plain text wants the characters back
const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return NAMED[entity.toLowerCase()] ?? match
  })

export const htmlToText = (html: string) =>
  decodeEntities(sanitize(html.replace(BLOCK_TAGS, ' '), { allowedTags: [], allowedAttributes: {} }))
    .replace(/\s+/g, ' ')
    .trim()
