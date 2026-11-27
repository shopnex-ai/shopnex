// The theme editor's preview protocol, between the ShopNex admin and a storefront in its iframe.
// Dependency-free (no zod/oRPC), so the storefront's preview script stays small in any framework.
//
//   1. The editor loads the storefront with ?shopnex_preview=<token>; the theme passes the token to
//      `storefront.theme.get`, which returns the draft (`preview: true`).
//   2. In preview, the page calls `connectThemePreview`, which tells the editor it is ready.
//   3. A click on a section (or a block) in the preview posts `select` back to the editor, which opens its settings.
//      The preview is for editing, not shopping: links, "add to cart" and cart-quantity buttons, submit buttons and
//      form submits do nothing in it (see `PREVIEW_BLOCKED_SELECTOR`). Carousel arrows, tabs and menu toggles still work.
//   4. The editor then posts `reload` after each saved draft and `select` when a section (or one of its blocks)
//      is picked. Sections are found by their `data-section-id` attribute (the section's id in the document), blocks
//      by `data-block-id` inside the section (what `{{ block.shopify_attributes }}` prints).
//
// An editor that never hears `ready` reloads the whole iframe after a save instead.

/** Query parameter carrying the editor's preview token; the theme passes it to `theme.get` */
export const THEME_PREVIEW_PARAM = 'shopnex_preview'
/** Attribute marking a rendered section with its ThemeSection id */
export const THEME_SECTION_ATTRIBUTE = 'data-section-id'
/** Attribute marking a rendered block with its ThemeBlock id (`{{ block.shopify_attributes }}` prints it) */
export const THEME_BLOCK_ATTRIBUTE = 'data-block-id'

export const THEME_EDITOR_SOURCE = 'shopnex-theme-editor'
export const THEME_PREVIEW_SOURCE = 'shopnex-theme-preview'

/** Editor → storefront */
export type ThemeEditorMessage =
  | { source: typeof THEME_EDITOR_SOURCE; type: 'reload' }
  | { source: typeof THEME_EDITOR_SOURCE; type: 'select'; sectionId: string; blockId?: string }

/** Storefront → editor: the page is ready, or the merchant clicked a section (and the block under the click, if any) */
export type ThemePreviewMessage =
  | { source: typeof THEME_PREVIEW_SOURCE; type: 'ready' }
  | { source: typeof THEME_PREVIEW_SOURCE; type: 'select'; sectionId: string; blockId?: string }

const isRecord = (data: unknown): data is Record<string, unknown> => typeof data === 'object' && data !== null

export function isThemeEditorMessage(data: unknown): data is ThemeEditorMessage {
  if (!isRecord(data) || data.source !== THEME_EDITOR_SOURCE) return false
  return (
    data.type === 'reload' ||
    (data.type === 'select' &&
      typeof data.sectionId === 'string' &&
      (data.blockId === undefined || typeof data.blockId === 'string'))
  )
}

export function isThemePreviewMessage(data: unknown): data is ThemePreviewMessage {
  if (!isRecord(data) || data.source !== THEME_PREVIEW_SOURCE) return false
  return (
    data.type === 'ready' ||
    (data.type === 'select' &&
      typeof data.sectionId === 'string' &&
      (data.blockId === undefined || typeof data.blockId === 'string'))
  )
}

export interface ConnectThemePreviewOptions {
  /** Origin of the ShopNex admin; messages from anywhere else are ignored */
  adminOrigin: string
  /** Replaces the default reload (a full page reload that keeps the scroll position) */
  onReload?: () => void
  /**
   * Replaces the default highlight (outline the section, or the block when one is picked, and scroll it into view);
   * `element` is the block's when it is on the page, else the section's, null when not on this page
   */
  onSelect?: (sectionId: string, element: HTMLElement | null, blockId?: string) => void
}

const SCROLL_KEY = 'shopnex-preview-scroll'

/**
 * What a click does nothing on in the preview: links (the page being edited stays put), the cart buttons themes mark
 * with `data-add-to-cart` / `data-line-qty` (the merchant must not fill real carts), and anything that submits a form
 * (search, newsletter, sign-in). Clicks elsewhere still reach the page, so carousels, tabs and menus can be tried.
 */
export const PREVIEW_BLOCKED_SELECTOR =
  'a, [data-add-to-cart], [data-line-qty], button:not([type="button"]):not([type="reset"]), input[type="submit"], input[type="image"]'

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
      const { sectionId, blockId } = event.data
      const section = document.querySelector<HTMLElement>(`[${THEME_SECTION_ATTRIBUTE}="${CSS.escape(sectionId)}"]`)
      // A block that is not shown (hidden, or a slide that is not the current one) falls back to its section
      const block = blockId
        ? section?.querySelector<HTMLElement>(`[${THEME_BLOCK_ATTRIBUTE}="${CSS.escape(blockId)}"]`)
        : null
      const element = block ?? section ?? null
      if (onSelect) onSelect(sectionId, element, blockId)
      else highlight(element)
    }
  }

  // A click in a section picks it in the editor; whatever the click was on, the blocked ones (above) do nothing
  function onClick(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest(PREVIEW_BLOCKED_SELECTOR)) {
      event.preventDefault()
      // The theme's own click handlers (add to cart…) are on the page or its elements, after this capture listener
      event.stopImmediatePropagation()
    }
    const section = target?.closest<HTMLElement>(`[${THEME_SECTION_ATTRIBUTE}]`)
    const sectionId = section?.getAttribute(THEME_SECTION_ATTRIBUTE)
    if (!section || !sectionId) return
    const blockId = target?.closest<HTMLElement>(`[${THEME_BLOCK_ATTRIBUTE}]`)?.getAttribute(THEME_BLOCK_ATTRIBUTE)
    const message: ThemePreviewMessage = {
      source: THEME_PREVIEW_SOURCE,
      type: 'select',
      sectionId,
      ...(blockId && { blockId }),
    }
    window.parent.postMessage(message, origin)
  }

  // Enter in a search box, a newsletter form: nothing is sent from the preview
  function onSubmit(event: SubmitEvent) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  window.addEventListener('message', onMessage)
  document.addEventListener('click', onClick, true)
  document.addEventListener('submit', onSubmit, true)
  const ready: ThemePreviewMessage = { source: THEME_PREVIEW_SOURCE, type: 'ready' }
  window.parent.postMessage(ready, origin)
  return () => {
    window.removeEventListener('message', onMessage)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('submit', onSubmit, true)
  }
}
