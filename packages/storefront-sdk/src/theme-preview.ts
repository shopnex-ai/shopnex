// The theme editor's preview protocol, between the Shopnex admin and a storefront in its iframe.
// Dependency-free (no zod/oRPC), so the storefront's preview script stays small in any framework.
//
//   1. The editor loads the storefront with ?shopnex_preview=<token>; the theme passes the token to
//      `storefront.theme.get`, which returns the draft (`preview: true`).
//   2. In preview, the page calls `connectThemePreview`, which tells the editor it is ready.
//   3. The editor then posts `reload` after each saved draft and `select` when a section is picked.
//      Sections are found by their `data-section-id` attribute (the section's id in the document).
//
// An editor that never hears `ready` reloads the whole iframe after a save instead.

/** Query parameter carrying the editor's preview token; the theme passes it to `theme.get` */
export const THEME_PREVIEW_PARAM = 'shopnex_preview'
/** Attribute marking a rendered section with its ThemeSection id */
export const THEME_SECTION_ATTRIBUTE = 'data-section-id'

export const THEME_EDITOR_SOURCE = 'shopnex-theme-editor'
export const THEME_PREVIEW_SOURCE = 'shopnex-theme-preview'

/** Editor → storefront */
export type ThemeEditorMessage =
  | { source: typeof THEME_EDITOR_SOURCE; type: 'reload' }
  | { source: typeof THEME_EDITOR_SOURCE; type: 'select'; sectionId: string }

/** Storefront → editor */
export type ThemePreviewMessage = { source: typeof THEME_PREVIEW_SOURCE; type: 'ready' }

const isRecord = (data: unknown): data is Record<string, unknown> => typeof data === 'object' && data !== null

export function isThemeEditorMessage(data: unknown): data is ThemeEditorMessage {
  if (!isRecord(data) || data.source !== THEME_EDITOR_SOURCE) return false
  return data.type === 'reload' || (data.type === 'select' && typeof data.sectionId === 'string')
}

export function isThemePreviewMessage(data: unknown): data is ThemePreviewMessage {
  return isRecord(data) && data.source === THEME_PREVIEW_SOURCE && data.type === 'ready'
}

export interface ConnectThemePreviewOptions {
  /** Origin of the Shopnex admin; messages from anywhere else are ignored */
  adminOrigin: string
  /** Replaces the default reload (a full page reload that keeps the scroll position) */
  onReload?: () => void
  /** Replaces the default highlight (outline the section and scroll it into view); null when not on this page */
  onSelect?: (sectionId: string, element: HTMLElement | null) => void
}

const SCROLL_KEY = 'shopnex-preview-scroll'

/**
 * Connects a storefront page to the theme editor. Call it in the browser, only when `theme.get`
 * returned `preview: true`. Returns a function that disconnects.
 */
export function connectThemePreview({ adminOrigin, onReload, onSelect }: ConnectThemePreviewOptions): () => void {
  const origin = new URL(adminOrigin).origin
  const saved = sessionStorage.getItem(SCROLL_KEY)
  if (saved) {
    sessionStorage.removeItem(SCROLL_KEY)
    const restore = () => window.scrollTo(0, Number(saved))
    if (document.readyState === 'complete') restore()
    else window.addEventListener('load', restore, { once: true })
  }

  let outlined: HTMLElement | null = null
  function highlight(element: HTMLElement | null) {
    if (outlined) outlined.style.outline = ''
    outlined = element
    if (!element) return
    element.style.outline = '2px solid #2563eb'
    element.style.outlineOffset = '-2px'
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function onMessage(event: MessageEvent) {
    if (event.origin !== origin || !isThemeEditorMessage(event.data)) return
    if (event.data.type === 'reload') {
      if (onReload) return onReload()
      sessionStorage.setItem(SCROLL_KEY, String(window.scrollY))
      location.reload()
    } else {
      const element = document.querySelector<HTMLElement>(
        `[${THEME_SECTION_ATTRIBUTE}="${CSS.escape(event.data.sectionId)}"]`,
      )
      if (onSelect) onSelect(event.data.sectionId, element)
      else highlight(element)
    }
  }

  window.addEventListener('message', onMessage)
  const ready: ThemePreviewMessage = { source: THEME_PREVIEW_SOURCE, type: 'ready' }
  window.parent.postMessage(ready, origin)
  return () => window.removeEventListener('message', onMessage)
}
