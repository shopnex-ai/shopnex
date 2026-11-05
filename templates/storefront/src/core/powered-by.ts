// The small "Powered by ShopNex" link on every storefront page, added by the storefront after the theme renders, so
// every theme (bundled or uploaded) gets it without writing it. The shop owner can switch it off in Settings → General.
const LINK = 'https://shopnex.ai/?utm_source=storefront&utm_medium=powered_by'

const BADGE =
  `<div style="padding:12px 16px;text-align:center;font:12px/1.4 system-ui,sans-serif;opacity:.7">` +
  `<a href="${LINK}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">Powered by ShopNex</a>` +
  `</div>`

/** The page's HTML with the badge just before `</body>` (at the end if the theme has no closing tag) */
export function withPoweredBy(html: string, show: boolean): string {
  if (!show) return html
  const end = html.lastIndexOf('</body>')
  return end === -1 ? html + BADGE : html.slice(0, end) + BADGE + html.slice(end)
}
