// A store's Contact page is usually a form with no text of its own (the form is not something we can bring across), while
// its contact details (phone, email, address) sit in the footer. This reads those details and makes a plain Contact page of
// them, so the link in the menu still leads to a way to reach the shop.
import { text } from './menu'

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The lines of the footer block headed "Contact…" (one line per list item or paragraph), at most 6 */
export function readContactLines(html: string): string[] {
  const footer = html.match(/<footer[\s\S]*?<\/footer>/i)?.[0] ?? ''
  const block = footer.match(
    /<h[1-6]\b[^>]*>(?:(?!<\/h[1-6]>)[\s\S])*contact(?:(?!<\/h[1-6]>)[\s\S])*<\/h[1-6]>([\s\S]*?)(?=<h[1-6]\b|$)/i,
  )?.[1]
  if (!block) return []
  const lines = [...block.matchAll(/<(li|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => text(m[2]!))
    .filter((line) => line.length > 2 && line.length <= 200)
  return [...new Set(lines)].slice(0, 6)
}

/** The page body: each line as a list item, an email address made a link */
export function contactHtml(lines: string[]): string {
  const item = (line: string) =>
    escape(line).replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (email) => `<a href="mailto:${email}">${email}</a>`)
  return `<ul>${lines.map((line) => `<li>${item(line)}</li>`).join('')}</ul>`
}
